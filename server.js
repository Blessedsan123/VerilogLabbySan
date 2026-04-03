/**
 * RTL Bench — Node.js Backend Server
 * Provides real Icarus Verilog and Verilator compilation/simulation
 * via REST API. Ships static frontend files.
 *
 * Endpoints:
 *   POST /api/simulate — compile + run, returns output + VCD signal data
 *   POST /api/download — returns a ZIP of design.v + testbench.sv
 *   GET  /             — serves index.html (and all static files)
 */

'use strict';

// Load .env file for local development (no-op on Render where env vars are set via dashboard)
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const archiver  = require('archiver');
const path      = require('path');
const fs        = require('fs');
const fsp       = require('fs/promises');
const os        = require('os');
const { execFile, spawn } = require('child_process');
const { v4: uuidv4 }      = require('uuid');
const { parseVCD }        = require('./vcd-parser');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ─── Serve static frontend files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ─── Utility: run a command with timeout, capture stdout/stderr ───────────────
function runProcess(cmd, args, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(cmd, args, { cwd, env: process.env });

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message, timedOut: false });
    });
  });
}

// ─── Check if a compiler is available ────────────────────────────────────────
function commandExists(cmd) {
  return new Promise(resolve => {
    execFile('which', [cmd], (err) => resolve(!err));
  });
}

// ─── POST /api/simulate ───────────────────────────────────────────────────────
app.post('/api/simulate', async (req, res) => {
  const { compiler = 'iverilog' } = req.body;

  // Support both legacy single-file and new multi-file API
  let designFiles    = req.body.designFiles    || (req.body.design    ? [{ name: 'design.v',    code: req.body.design    }] : []);
  let testbenchFiles = req.body.testbenchFiles || (req.body.testbench ? [{ name: 'testbench.sv', code: req.body.testbench }] : []);

  if (!designFiles.length || !testbenchFiles.length) {
    return res.status(400).json({ success: false, error: 'At least one design file and one testbench file are required.' });
  }

  // Create isolated temp directory for this simulation
  const tmpDir = path.join(os.tmpdir(), `rtlbench_${uuidv4()}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const vcdFile   = path.join(tmpDir, 'dump.vcd');
  const outputBin = path.join(tmpDir, 'sim.vvp');

  const output  = []; // console lines sent to frontend
  const warnings = [];
  let vcdData   = null;
  let success   = false;
  let compilerVersion = '';

  // All source files written to tmpDir
  const allSrcFiles = [];

  try {
    // Write all source files to tmpDir
    for (const f of designFiles) {
      const filePath = path.join(tmpDir, f.name);
      await fsp.writeFile(filePath, f.code || '', 'utf8');
      allSrcFiles.push(filePath);
    }
    for (const f of testbenchFiles) {
      const filePath = path.join(tmpDir, f.name);
      await fsp.writeFile(filePath, f.code || '', 'utf8');
      allSrcFiles.push(filePath);
    }

    // ── Icarus Verilog path ────────────────────────────────────────────────
    if (compiler === 'iverilog') {
      const available = await commandExists('iverilog');

      if (!available) {
        // Fallback: return a helpful error message
        return res.json({
          success: false,
          output: [
            '! iverilog not found on this server.',
            '  To deploy with real simulation, use the provided Dockerfile.',
            '  The Dockerfile installs iverilog automatically on the server.',
          ],
          vcd: null,
          compiler: 'iverilog',
          error: 'Compiler not installed on server. Deploy with Dockerfile.',
        });
      }

      // Get version
      const versionResult = await runProcess('iverilog', ['-V'], tmpDir, 5000);
      compilerVersion = (versionResult.stderr || versionResult.stdout).split('\n')[0];
      output.push(`# Compiler: ${compilerVersion}`);
      output.push('');

      // Step 1: Compile — pass all files together (no `include needed)
      const fileList = allSrcFiles.map(f => path.basename(f));
      output.push(`▶ Compiling ${fileList.length} file(s) with Icarus Verilog...`);
      output.push(`  Files: ${fileList.join(', ')}`);
      const compileResult = await runProcess(
        'iverilog',
        ['-g2012', '-Wall', '-o', outputBin, ...allSrcFiles],
        tmpDir
      );

      if (compileResult.timedOut) {
        success = false;
        output.push('✗ Compilation timed out (>30s)');
      } else {
        // Parse compile output
        const compileLines = (compileResult.stdout + compileResult.stderr).split('\n').filter(Boolean);
        compileLines.forEach(line => {
          const l = line.trim();
          if (!l) return;
          // Shorten file paths to just filename
          const cleaned = l.replace(new RegExp(tmpDir + '/', 'g'), '');
          if (/warning/i.test(cleaned)) {
            warnings.push(cleaned);
            output.push(`⚠ ${cleaned}`);
          } else if (/error/i.test(cleaned)) {
            output.push(`✗ ${cleaned}`);
          } else {
            output.push(cleaned);
          }
        });

        if (compileResult.code !== 0) {
          success = false;
          output.push('');
          output.push(`✗ Compilation failed (exit code ${compileResult.code})`);
        } else {
          output.push('✓ Compilation successful');
          output.push('');
          output.push('▶ Running simulation...');

          // Step 2: Run simulation with vvp
          const simResult = await runProcess('vvp', [outputBin], tmpDir);

          if (simResult.timedOut) {
            success = false;
            output.push('✗ Simulation timed out (>30s). Check for infinite loops or missing $finish.');
          } else {
            // Emit simulation stdout
            const simLines = simResult.stdout.split('\n');
            simLines.forEach(line => {
              if (line.trim()) output.push(line);
            });

            // Any stderr from vvp
            if (simResult.stderr.trim()) {
              simResult.stderr.split('\n').forEach(line => {
                if (line.trim()) output.push(`⚠ ${line}`);
              });
            }

            output.push('');
            if (simResult.code !== 0) {
              success = false;
              output.push(`✗ Simulation exited with code ${simResult.code}`);
            } else {
              success = true;
              output.push('✓ Simulation completed successfully');
            }

            // Parse VCD — find any .vcd file produced by the simulation
            const dirEntries = fs.readdirSync(tmpDir);
            const vcdFiles   = dirEntries.filter(f => f.endsWith('.vcd'));
            if (vcdFiles.length > 0) {
              const foundVcd = path.join(tmpDir, vcdFiles[0]);
              try {
                const vcdText = await fsp.readFile(foundVcd, 'utf8');
                vcdData = parseVCD(vcdText);
                output.push(`✓ Waveform data captured (${vcdData.signals.length} signals, ${vcdData.totalTime}ns)`);
              } catch (vcdErr) {
                output.push(`⚠ VCD parse error: ${vcdErr.message}`);
              }
            } else {
              output.push('ℹ No waveform dump found. Add $dumpfile/$dumpvars to testbench for waveforms.');
            }
          }
        }
      }
    }

    // ── Verilator path ─────────────────────────────────────────────────────
    else if (compiler === 'verilator') {
      const available = await commandExists('verilator');

      if (!available) {
        return res.json({
          success: false,
          output: [
            '! verilator not found on this server.',
            '  Deploy using the provided Dockerfile to enable Verilator.',
          ],
          vcd: null,
          compiler: 'verilator',
          error: 'Compiler not installed on server.',
        });
      }

      // Verilator needs a C++ wrapper for standalone simulation
      const tbMain = `
#include "Vtb_${getModuleName(testbench)}.h"
#include "verilated.h"
#include "verilated_vcd_c.h"
int main(int argc, char** argv) {
    Verilated::commandArgs(argc, argv);
    Verilated::traceEverOn(true);
    auto* top = new Vtb_${getModuleName(testbench)}();
    VerilatedVcdC* tfp = new VerilatedVcdC();
    top->trace(tfp, 99);
    tfp->open("dump.vcd");
    while (!Verilated::gotFinish()) {
        top->eval();
        tfp->dump(Verilated::time());
        Verilated::timeInc(1);
    }
    tfp->close();
    delete top;
    return 0;
}
`;
      const tbMainFile = path.join(tmpDir, 'tb_main.cpp');
      await fsp.writeFile(tbMainFile, tbMain, 'utf8');

      const versionResult = await runProcess('verilator', ['--version'], tmpDir, 5000);
      compilerVersion = (versionResult.stdout || versionResult.stderr).split('\n')[0];
      output.push(`# Compiler: ${compilerVersion}`);
      output.push('');
      output.push('▶ Compiling with Verilator...');

      const compileResult = await runProcess(
        'verilator',
        ['--cc', '--exe', '--build', '--trace', '-Wno-fatal',
         designFile, testbenchFile, tbMainFile,
         '--top-module', `tb_${getModuleName(testbench)}`],
        tmpDir
      );

      const compileLines = (compileResult.stdout + compileResult.stderr).split('\n').filter(Boolean);
      compileLines.forEach(line => {
        const cleaned = line.replace(new RegExp(tmpDir + '/', 'g'), '');
        if (cleaned.trim()) output.push(cleaned);
      });

      if (compileResult.code !== 0) {
        success = false;
        output.push(`✗ Verilator compilation failed`);
      } else {
        output.push('✓ Compilation successful');
        output.push('');
        output.push('▶ Running simulation...');

        // Find and run the generated binary
        const objDir = path.join(tmpDir, 'obj_dir');
        const binName = `Vtb_${getModuleName(testbench)}`;
        const binPath = path.join(objDir, binName);

        const simResult = await runProcess(binPath, [], tmpDir);
        simResult.stdout.split('\n').forEach(line => { if (line.trim()) output.push(line); });
        if (simResult.stderr.trim()) output.push(`⚠ ${simResult.stderr}`);

        success = simResult.code === 0;
        output.push('');
        output.push(success ? '✓ Simulation completed' : `✗ Simulation failed (code ${simResult.code})`);

        if (fs.existsSync(vcdFile)) {
          const vcdText = await fsp.readFile(vcdFile, 'utf8');
          vcdData = parseVCD(vcdText);
          output.push(`✓ Waveform captured (${vcdData.signals.length} signals)`);
        }
      }
    }

    else {
      return res.status(400).json({ success: false, error: `Unknown compiler: ${compiler}` });
    }

  } catch (err) {
    console.error('Simulation error:', err);
    output.push(`✗ Server error: ${err.message}`);
    success = false;
  } finally {
    // Async cleanup — don't await, just fire and forget
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return res.json({ success, output, vcd: vcdData, compiler, warnings });
});

// ─── POST /api/elaborate ──────────────────────────────────────────────────────
app.post('/api/elaborate', async (req, res) => {
  const designFiles = req.body.designFiles || [];
  if (!designFiles.length) {
    return res.status(400).json({ success: false, error: 'No design files provided.' });
  }

  const tmpDir = path.join(os.tmpdir(), `rtlbench_elab_${uuidv4()}`);
  let success = false;
  let jsonOutput = null;

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
    const allSrcFiles = [];

    // Write all logic files
    for (const f of designFiles) {
      const filePath = path.join(tmpDir, f.name);
      await fsp.writeFile(filePath, f.code || '', 'utf8');
      allSrcFiles.push(f.name);
    }

    const jsonFile = path.join(tmpDir, 'out.json');
    // Run yosys to generate digitaljs-compatible json
    const result = await runProcess(
      'yosys',
      ['-p', 'hierarchy -auto-top; proc; opt -nodffe -nosdff; memory; opt -nodffe -nosdff; clean; write_json out.json', ...allSrcFiles],
      tmpDir
    );

    if (result.code !== 0) {
      return res.status(500).json({ success: false, error: result.stderr || result.stdout || 'Yosys failed to execute.' });
    }

    if (fs.existsSync(jsonFile)) {
      const jsonText = await fsp.readFile(jsonFile, 'utf8');
      const yosysOutput = JSON.parse(jsonText);
      const { yosys2digitaljs } = require('yosys2digitaljs/core');
      jsonOutput = yosys2digitaljs(yosysOutput);
      success = true;
    } else {
      return res.status(500).json({ success: false, error: 'Yosys failed to produce JSON output.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return res.json({ success, netlist: jsonOutput });
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
const Groq = require('groq-sdk');

app.post('/api/chat', async (req, res) => {
  const { messages, designFiles, testbenchFiles } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'Messages array is required.' });
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ success: false, error: 'GROQ_API_KEY environment variable is not set.' });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Format the context
    let contextStr = "### Current Code Context:\n\n";
    if (designFiles && designFiles.length) {
      contextStr += "#### Design Files:\n";
      designFiles.forEach(f => { contextStr += `// File: ${f.name}\n${f.code}\n\n`; });
    }
    if (testbenchFiles && testbenchFiles.length) {
      contextStr += "#### Testbench Files:\n";
      testbenchFiles.forEach(f => { contextStr += `// File: ${f.name}\n${f.code}\n\n`; });
    }

    const systemPrompt = `You are a helpful and expert AI assistant integrated into "VerilogLab", a browser-based Verilog and SystemVerilog IDE. 
Your primary goal is to help users write, debug, properly design, and understand Verilog and SystemVerilog code.
When providing code, do NOT wrap it in unnecessary explanations unless asked; be concise and extremely precise.
Always prioritize providing syntactically correct and synthesizable RTL and robust simulation testbenches.
If you suggest code to replace an existing block, the user has a quick "Paste" button to inject it into their editor!

Here is the user's current project context. Use it to inform your answers, but do not simply restate it unless explaining a bug:
${contextStr}
`;

    // Map messages payload to Groq/OpenAI API history format
    const history = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));

    history.unshift({ role: 'system', content: systemPrompt });

    const chatCompletion = await groq.chat.completions.create({
      messages: history,
      model: "llama-3.3-70b-versatile", // Fast and capable open source model
    });

    const responseText = chatCompletion.choices[0]?.message?.content || "";

    return res.json({ success: true, text: responseText });

  } catch (err) {
    console.error('Chat API error:', err);

    // Provide friendly error messages for common API failures
    let userMessage = err.message || JSON.stringify(err);
    if (err.status === 429) {
      userMessage = '⚠️ API quota exceeded. Your Groq API key has hit its limit. Please wait a few minutes and try again.';
    } else if (err.status === 401 || err.status === 403) {
      userMessage = '🔑 API key error. Check that GROQ_API_KEY is valid.';
    } else if (err.error && err.error.error && err.error.error.message) {
      userMessage = `❌ Request Error: ${err.error.error.message}`;
    }

    return res.status(500).json({ success: false, error: userMessage });
  }
});

// ─── POST /api/download ───────────────────────────────────────────────────────
app.post('/api/download', (req, res) => {
  // Support both legacy and multi-file API
  const designFiles    = req.body.designFiles    || (req.body.design    ? [{ name: 'design.v',    code: req.body.design    }] : []);
  const testbenchFiles = req.body.testbenchFiles || (req.body.testbench ? [{ name: 'testbench.sv', code: req.body.testbench }] : []);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="rtlbench_project.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { res.status(500).end(); console.error(err); });
  archive.pipe(res);

  for (const f of designFiles)    archive.append(f.code || '', { name: f.name });
  for (const f of testbenchFiles) archive.append(f.code || '', { name: f.name });
  archive.finalize();
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Helper: extract top module name from testbench code ─────────────────────
function getModuleName(code) {
  const match = code.match(/\bmodule\s+(\w+)/);
  return match ? match[1] : 'testbench';
}

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  VerilogLab server running at http://localhost:${PORT}`);
  console.log(`  AI Chat Model: Groq LLaMA 3.3 (llama-3.3-70b-versatile)`);
  console.log(`  Groq API key set:    ${process.env.GROQ_API_KEY ? '✓ YES' : '✗ NO — set GROQ_API_KEY'}`);
  console.log(`  Press Ctrl+C to stop\n`);

  // Verify compilers at startup
  Promise.all([
    commandExists('iverilog'),
    commandExists('verilator'),
    commandExists('yosys'),
  ]).then(([haveIverilog, haveVerilator, haveYosys]) => {
    console.log(`  iverilog:  ${haveIverilog  ? '✓ found' : '✗ not found (deploy with Dockerfile)'}`);
    console.log(`  verilator: ${haveVerilator ? '✓ found' : '✗ not found (deploy with Dockerfile)'}`);
    console.log(`  yosys:     ${haveYosys     ? '✓ found' : '✗ not found (for RTL elaboration)'}\n`);
  });
});
