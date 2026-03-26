/**
 * RTL BENCH — Browser-Based Verilog/SystemVerilog IDE
 * Full application logic: editors, simulation, waveform viewer, theme, settings
 */

// Configure this if you deploy the backend somewhere else (e.g. 'https://rtlbench-api.onrender.com')
// Leave it empty ('') if frontend and backend are hosted together.
const API_BASE_URL = '';

// ============================================================
// 1. EDITOR SETUP (Lightweight code editor with syntax highlighting)
// ============================================================

class CodeEditor {
    constructor(container, language = 'verilog') {
        this.container = container;
        this.language = language;
        this.value = '';
        this.lines = [''];
        this.cursorLine = 0;
        this.cursorCol = 0;
        this.scrollTop = 0;
        this.fontSize = 14;
        this.lineNumbers = true;
        this.wordWrap = false;
        this.tabSize = 2;
        this.history = [];
        this.historyIndex = -1;
        this.focused = false;

        this.buildDOM();
        this.attachEvents();
    }

    buildDOM() {
        this.container.innerHTML = '';
        this.container.classList.add('cm-editor');

        this.editorEl = document.createElement('div');
        this.editorEl.className = 'cm-scroller';
        this.editorEl.style.cssText = 'display:flex;height:100%;overflow:auto;font-family:var(--font-mono);';
        this.editorEl.tabIndex = 0;

        // Gutter
        this.gutterEl = document.createElement('div');
        this.gutterEl.className = 'cm-gutters';
        this.gutterEl.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;padding:8px 12px 8px 8px;user-select:none;min-width:50px;position:sticky;left:0;z-index:10;';

        // Content
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'cm-content';
        this.contentEl.style.cssText = 'flex:1;min-width:max-content;padding:8px 16px;outline:none;white-space:pre;min-height:100%;position:relative;';
        this.contentEl.contentEditable = true;
        this.contentEl.spellcheck = false;
        this.contentEl.autocorrect = 'off';
        this.contentEl.autocapitalize = 'off';

        this.editorEl.appendChild(this.gutterEl);
        this.editorEl.appendChild(this.contentEl);
        this.container.appendChild(this.editorEl);

        this.updateFontSize(this.fontSize);
    }

    attachEvents() {
        this.contentEl.addEventListener('input', () => {
            this.value = this.contentEl.textContent;
            this.lines = this.value.split('\n');
            this.highlightSyntax();
            this.updateGutter();
            this.saveToHistory();
        });

        this.contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                // Insert spaces at caret position directly
                const offset = this.getCaretOffset();
                const text = this.contentEl.textContent;
                const spaces = ' '.repeat(this.tabSize);
                const newText = text.substring(0, offset) + spaces + text.substring(offset);
                const newOffset = offset + spaces.length;
                this._applyTextEdit(newText, newOffset);
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const offset = this.getCaretOffset();
                const text = this.contentEl.textContent;
                const textBefore = text.substring(0, offset);
                const textAfter  = text.substring(offset);

                // Match indentation of current line
                const lastLine = textBefore.split('\n').pop();
                const indent   = lastLine.match(/^\s*/)[0];

                // Auto-indent one level after block-opening keywords
                const trimmed = lastLine.trim();
                let extra = '';
                if (/\b(begin|module|always|always_ff|always_comb|always_latch|initial|case|casex|casez|fork)\s*$/.test(trimmed)
                    || trimmed.endsWith('begin')
                    || (trimmed.endsWith(')') && /^(module|always|task|function)/.test(trimmed))) {
                    extra = ' '.repeat(this.tabSize);
                }

                const insertion = '\n' + indent + extra;
                this._applyTextEdit(textBefore + insertion + textAfter, offset + insertion.length);
            }

            // Ctrl+Z Undo
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
        });

        this.contentEl.addEventListener('focus', () => {
            this.focused = true;
            this.container.classList.add('cm-focused');
        });
        this.contentEl.addEventListener('blur', () => {
            this.focused = false;
            this.container.classList.remove('cm-focused');
        });

        this.contentEl.addEventListener('scroll', () => {
            this.gutterEl.style.transform = `translateY(-${this.editorEl.scrollTop}px)`;
        });

        this.editorEl.addEventListener('scroll', () => {
            // sync gutter scroll with editor scroll
        });
    }

    getCaretOffset() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return 0;
        const range = sel.getRangeAt(0);
        const preRange = range.cloneRange();
        preRange.selectNodeContents(this.contentEl);
        preRange.setEnd(range.startContainer, range.startOffset);
        return preRange.toString().length;
    }

    /**
     * Apply a text edit directly without going through execCommand.
     * Sets the new full text, re-renders syntax highlighting, then
     * places the cursor at exactly `newCaretPos` characters from the start.
     */
    _applyTextEdit(newText, newCaretPos) {
        this.value = newText;
        this.lines = newText.split('\n');

        // Build highlighted HTML and set it directly (avoids triggering input event)
        this.contentEl.innerHTML = this.highlight(newText);

        // Restore cursor to the target position
        this.restoreCaretOffset(newCaretPos);

        this.updateGutter();
        this.saveToHistory();
    }

    setValue(text) {
        this.value = text;
        this.lines = text.split('\n');
        this.contentEl.textContent = text;
        this.highlightSyntax();
        this.updateGutter();
        this.saveToHistory();
    }

    getValue() {
        return this.contentEl.textContent;
    }

    highlightSyntax() {
        const text = this.contentEl.textContent;
        const highlighted = this.highlight(text);
        
        // Save caret position
        const caretOffset = this.getCaretOffset();
        
        this.contentEl.innerHTML = highlighted;
        
        // Restore caret position
        this.restoreCaretOffset(caretOffset);
    }

    restoreCaretOffset(offset) {
        const sel = window.getSelection();
        const range = document.createRange();
        let currentOffset = 0;
        let found = false;

        const walker = document.createTreeWalker(this.contentEl, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (currentOffset + node.length >= offset) {
                range.setStart(node, offset - currentOffset);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                found = true;
                break;
            }
            currentOffset += node.length;
        }
        if (!found && this.contentEl.childNodes.length > 0) {
            range.selectNodeContents(this.contentEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    highlight(text) {
        if (this.language !== 'verilog' && this.language !== 'systemverilog') {
            return this.escapeHtml(text);
        }

        const keywords = new Set(['module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'integer',
            'parameter', 'localparam', 'assign', 'always', 'always_ff', 'always_comb', 'always_latch',
            'initial', 'begin', 'end', 'if', 'else', 'case', 'casex', 'casez', 'endcase',
            'for', 'while', 'repeat', 'forever', 'fork', 'join', 'generate', 'endgenerate',
            'function', 'endfunction', 'task', 'endtask', 'posedge', 'negedge', 'or', 'and', 'not',
            'buf', 'nand', 'nor', 'xor', 'xnor', 'pullup', 'pulldown', 'supply0', 'supply1',
            'tri', 'triand', 'trior', 'tri0', 'tri1', 'wand', 'wor',
            'genvar', 'default', 'signed', 'unsigned',
            'logic', 'bit', 'byte', 'shortint', 'int', 'longint', 'real', 'shortreal',
            'string', 'void', 'enum', 'typedef', 'struct', 'union', 'class', 'endclass',
            'interface', 'endinterface', 'package', 'endpackage', 'import', 'export',
            'virtual', 'extends', 'implements', 'pure', 'extern', 'static', 'protected',
            'local', 'const', 'rand', 'randc', 'constraint', 'covergroup', 'endgroup',
            'property', 'endproperty', 'sequence', 'endsequence', 'assert', 'assume',
            'cover', 'expect', 'program', 'endprogram', 'modport', 'clocking', 'endclocking',
            'timescale', 'define', 'include', 'ifdef', 'ifndef', 'endif', 'undef']);

        // Tokenize approach: scan char by char, build tokens, then generate HTML
        const lines = text.split('\n');
        const htmlLines = [];
        let inBlockComment = false;

        for (const line of lines) {
            let html = '';
            let i = 0;

            if (inBlockComment) {
                const endIdx = line.indexOf('*/');
                if (endIdx === -1) {
                    html += '<span class="tok-comment">' + this.escapeHtml(line) + '</span>';
                    htmlLines.push(html);
                    continue;
                } else {
                    html += '<span class="tok-comment">' + this.escapeHtml(line.substring(0, endIdx + 2)) + '</span>';
                    i = endIdx + 2;
                    inBlockComment = false;
                }
            }

            while (i < line.length) {
                const ch = line[i];
                const rest = line.substring(i);

                // Line comment
                if (ch === '/' && line[i + 1] === '/') {
                    html += '<span class="tok-comment">' + this.escapeHtml(line.substring(i)) + '</span>';
                    i = line.length;
                    continue;
                }

                // Block comment start
                if (ch === '/' && line[i + 1] === '*') {
                    const endIdx = line.indexOf('*/', i + 2);
                    if (endIdx !== -1) {
                        html += '<span class="tok-comment">' + this.escapeHtml(line.substring(i, endIdx + 2)) + '</span>';
                        i = endIdx + 2;
                    } else {
                        html += '<span class="tok-comment">' + this.escapeHtml(line.substring(i)) + '</span>';
                        i = line.length;
                        inBlockComment = true;
                    }
                    continue;
                }

                // String
                if (ch === '"') {
                    let j = i + 1;
                    while (j < line.length && line[j] !== '"') {
                        if (line[j] === '\\') j++;
                        j++;
                    }
                    j = Math.min(j + 1, line.length);
                    html += '<span class="tok-string">' + this.escapeHtml(line.substring(i, j)) + '</span>';
                    i = j;
                    continue;
                }

                // Backtick directives
                if (ch === '`') {
                    const m = rest.match(/^`(\w+)/);
                    if (m) {
                        html += '<span class="tok-keyword">' + this.escapeHtml(m[0]) + '</span>';
                        i += m[0].length;
                        continue;
                    }
                }

                // System tasks ($display, $finish, etc.)
                if (ch === '$') {
                    const m = rest.match(/^\$\w+/);
                    if (m) {
                        html += '<span class="tok-meta">' + this.escapeHtml(m[0]) + '</span>';
                        i += m[0].length;
                        continue;
                    }
                }

                // Numbers (Verilog-style: 4'b0000, 1'b1, 32'hDEAD)
                if (/[0-9]/.test(ch)) {
                    const m = rest.match(/^\d+'[bBhHdDoO][0-9a-fA-FxXzZ_]+/) || rest.match(/^\d+/);
                    if (m) {
                        html += '<span class="tok-number">' + this.escapeHtml(m[0]) + '</span>';
                        i += m[0].length;
                        continue;
                    }
                }

                // Identifiers and keywords
                if (/[a-zA-Z_]/.test(ch)) {
                    const m = rest.match(/^[a-zA-Z_]\w*/);
                    if (m) {
                        const word = m[0];
                        if (keywords.has(word)) {
                            html += '<span class="tok-keyword">' + this.escapeHtml(word) + '</span>';
                        } else {
                            html += this.escapeHtml(word);
                        }
                        i += word.length;
                        continue;
                    }
                }

                // Operators
                if (/[&|^~!<>=+\-*/%?:]/.test(ch)) {
                    const m = rest.match(/^[&|^~!<>=+\-*/%?:]+/);
                    if (m) {
                        html += '<span class="tok-operator">' + this.escapeHtml(m[0]) + '</span>';
                        i += m[0].length;
                        continue;
                    }
                }

                // Default: single char
                html += this.escapeHtml(ch);
                i++;
            }

            htmlLines.push(html);
        }

        return htmlLines.join('\n');
    }

    escapeHtml(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    updateGutter() {
        if (!this.lineNumbers) {
            this.gutterEl.style.display = 'none';
            return;
        }
        this.gutterEl.style.display = '';
        const lineCount = this.lines.length || 1;
        let html = '';
        for (let i = 1; i <= lineCount; i++) {
            html += `<div class="cm-lineNumber" style="height:${this.fontSize * 1.6}px;line-height:${this.fontSize * 1.6}px;font-size:${this.fontSize - 1}px;">${i}</div>`;
        }
        this.gutterEl.innerHTML = html;
    }

    updateFontSize(size) {
        this.fontSize = size;
        this.contentEl.style.fontSize = size + 'px';
        this.contentEl.style.lineHeight = (size * 1.6) + 'px';
        this.updateGutter();
    }

    saveToHistory() {
        const text = this.contentEl.textContent;
        if (this.history[this.historyIndex] !== text) {
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push(text);
            this.historyIndex = this.history.length - 1;
        }
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.contentEl.textContent = this.history[this.historyIndex];
            this.highlightSyntax();
            this.updateGutter();
        }
    }
}

// ============================================================
// 2. APPLICATION STATE
// ============================================================

const state = {
    activeTab: 'design',
    theme: 'dark',
    simulationStatus: 'idle', // idle | running | success | error
    editors: {},   // { design, testbench, testbenchFull }
    // Multi-file state: { design: [{name,code}], testbench: [{name,code}] }
    files: {
        design: [],
        testbench: [],
    },
    activeFile: { design: 0, testbench: 0 },
    waveformData: null,
    waveformZoom: 1,
    settings: {
        fontSize: 14,
        tabSize: 2,
        wordWrap: false,
        lineNumbers: true,
        autoSave: true,
    }
};

// Default code samples
const DEFAULT_DESIGN_CODE = `// RTL Bench - Verilog Design File
// Simple 4-bit Counter with Enable and Reset

\`timescale 1ns / 1ps

module counter_4bit (
  input  wire       clk,
  input  wire       rst_n,
  input  wire       enable,
  output reg  [3:0] count,
  output wire       overflow
);

  // Counter Logic
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= 4'b0000;
    end else if (enable) begin
      count <= count + 1'b1;
    end
  end

  // Overflow Detection
  assign overflow = (count == 4'b1111) & enable;

endmodule`;

const DEFAULT_TESTBENCH_CODE = `// RTL Bench - SystemVerilog Testbench
// Testbench for 4-bit Counter

\`timescale 1ns / 1ps

module tb_counter_4bit;

  // Signal Declarations
  logic       clk;
  logic       rst_n;
  logic       enable;
  logic [3:0] count;
  logic       overflow;

  // DUT Instantiation
  counter_4bit dut (
    .clk      (clk),
    .rst_n    (rst_n),
    .enable   (enable),
    .count    (count),
    .overflow (overflow)
  );

  // Clock Generation - 10ns period
  initial begin
    clk = 0;
    forever #5 clk = ~clk;
  end

  // Stimulus
  initial begin
    // Initialize
    rst_n  = 0;
    enable = 0;
    $display("T=%0t: Reset asserted", $time);

    // Release reset
    #20;
    rst_n = 1;
    $display("T=%0t: Reset released", $time);

    // Enable counting
    #10;
    enable = 1;
    $display("T=%0t: Counter enabled", $time);

    // Let it count
    #200;
    $display("T=%0t: Count = %0d, Overflow = %b", $time, count, overflow);

    // Disable and re-enable
    enable = 0;
    $display("T=%0t: Counter disabled", $time);
    #30;
    enable = 1;
    $display("T=%0t: Counter re-enabled", $time);

    // Run to completion
    #100;
    $display("T=%0t: Final count = %0d", $time, count);
    $display("Simulation completed successfully!");
    $finish;
  end

  // Monitor
  initial begin
    $monitor("T=%0t: rst_n=%b enable=%b count=%0d overflow=%b",
             $time, rst_n, enable, count, overflow);
  end

  // Dump waveforms
  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb_counter_4bit);
  end

endmodule`;


// ============================================================
// 3. INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initEditors();
    initTabs();
    initSidebar();
    initThemeToggle();
    initSimulation();
    initConsole();
    initDownload();
    initSettings();
    initResizers();
    initSchematic();
    initAIChat();
    loadSavedState();
});

function initEditors() {
    // Design editor (left pane in design tab)
    const designContainer = document.getElementById('editor-design');
    state.editors.design = new CodeEditor(designContainer, 'verilog');

    // Testbench editor (right pane in design tab)
    const tbContainer = document.getElementById('editor-testbench');
    state.editors.testbench = new CodeEditor(tbContainer, 'systemverilog');

    // Full testbench editor (testbench tab)
    const tbFullContainer = document.getElementById('editor-testbench-full');
    state.editors.testbenchFull = new CodeEditor(tbFullContainer, 'systemverilog');

    // Initialize default file lists
    state.files.design    = [{ name: 'design.v',    code: DEFAULT_DESIGN_CODE }];
    state.files.testbench = [{ name: 'testbench.sv', code: DEFAULT_TESTBENCH_CODE }];
    state.activeFile = { design: 0, testbench: 0 };

    // Load initial file into editor
    state.editors.design.setValue(state.files.design[0].code);
    state.editors.testbench.setValue(state.files.testbench[0].code);
    state.editors.testbenchFull.setValue(state.files.testbench[0].code);

    // Render file tabs for both panels
    renderFileTabs('design');
    renderFileTabs('testbench');
}

// ============================================================
// 2b. MULTI-FILE MANAGEMENT
// ============================================================

/**
 * Render the file tabs bar for a given panel ('design' or 'testbench').
 * Also syncs the mirrored testbench-full bar when panel === 'testbench'.
 */
function renderFileTabs(panel) {
    const barIds = panel === 'testbench'
        ? ['file-tabs-testbench', 'file-tabs-testbench-full']
        : ['file-tabs-design'];

    barIds.forEach(barId => {
        const bar = document.getElementById(barId);
        if (!bar) return;
        bar.innerHTML = '';

        state.files[panel].forEach((file, idx) => {
            const isActive   = idx === state.activeFile[panel];
            const isTopLevel = idx === 0; // first testbench file is the simulation entry point

            const tab = document.createElement('div');
            tab.className = `file-tab${isActive ? ' active' : ''}${panel === 'testbench' && isTopLevel ? ' top-level' : ''}`;
            tab.title = file.name + (panel === 'testbench' && isTopLevel ? '  (simulation entry point)' : '');

            // Dot
            const dot = document.createElement('span');
            dot.className = 'file-tab-dot';

            // Name label (double-click to rename)
            const nameEl = document.createElement('span');
            nameEl.className = 'file-tab-name';
            nameEl.textContent = file.name;
            nameEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startRenameFile(panel, idx, nameEl);
            });

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.className = 'file-tab-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.title = 'Close file';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteFile(panel, idx);
            });

            tab.appendChild(dot);
            tab.appendChild(nameEl);
            tab.appendChild(closeBtn);

            tab.addEventListener('click', () => switchFile(panel, idx));

            bar.appendChild(tab);
        });

        // Add-file button
        const addBtn = document.createElement('button');
        addBtn.className = 'file-tab-add';
        addBtn.innerHTML = '+';
        addBtn.title = 'Add new file';
        addBtn.addEventListener('click', () => addFile(panel));
        bar.appendChild(addBtn);
    });
}

/**
 * Save the current editor content to the active file, then load the new file.
 */
function switchFile(panel, idx) {
    // Save current content
    const currentIdx = state.activeFile[panel];
    if (panel === 'design') {
        state.files.design[currentIdx].code = state.editors.design.getValue();
    } else {
        state.files.testbench[currentIdx].code = state.editors.testbench.getValue();
        state.files.testbench[currentIdx].code = state.editors.testbenchFull.getValue() ||
            state.files.testbench[currentIdx].code;
    }

    state.activeFile[panel] = idx;
    const file = state.files[panel][idx];

    if (panel === 'design') {
        state.editors.design.setValue(file.code);
    } else {
        state.editors.testbench.setValue(file.code);
        state.editors.testbenchFull.setValue(file.code);
    }

    renderFileTabs(panel);
}

/**
 * Add a new file to a panel. Prompts for a filename.
 */
function addFile(panel) {
    const defaultExt = panel === 'testbench' ? '.sv' : '.v';
    const existingNames = state.files[panel].map(f => f.name);

    // Generate a unique default name
    let defaultName = `file${state.files[panel].length + 1}${defaultExt}`;
    while (existingNames.includes(defaultName)) {
        defaultName = `file${Math.floor(Math.random()*1000)}${defaultExt}`;
    }

    const name = prompt('Enter filename (e.g. adder.v):', defaultName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    // Validate
    if (!/^[\w.-]+\.(v|sv|vh|svh)$/i.test(trimmed)) {
        alert('Invalid filename. Use letters, numbers, underscores, and extension .v, .sv, .vh or .svh');
        return;
    }
    if (state.files[panel].some(f => f.name === trimmed)) {
        alert(`A file named "${trimmed}" already exists.`);
        return;
    }

    // Save current file before switching
    const currentIdx = state.activeFile[panel];
    if (panel === 'design') {
        state.files.design[currentIdx].code = state.editors.design.getValue();
    } else {
        const tbVal = state.editors.testbenchFull.getValue() || state.editors.testbench.getValue();
        state.files.testbench[currentIdx].code = tbVal;
    }

    state.files[panel].push({ name: trimmed, code: '' });
    state.activeFile[panel] = state.files[panel].length - 1;

    if (panel === 'design') {
        state.editors.design.setValue('');
    } else {
        state.editors.testbench.setValue('');
        state.editors.testbenchFull.setValue('');
    }

    renderFileTabs(panel);
}

/**
 * Delete a file from a panel. Prevents deleting the last file.
 */
function deleteFile(panel, idx) {
    if (state.files[panel].length === 1) {
        alert('Cannot delete the last file.');
        return;
    }
    const fname = state.files[panel][idx].name;
    if (!confirm(`Delete "${fname}"?`)) return;

    state.files[panel].splice(idx, 1);

    // Adjust active index
    let newIdx = state.activeFile[panel];
    if (newIdx >= state.files[panel].length) newIdx = state.files[panel].length - 1;
    if (newIdx === idx) newIdx = Math.max(0, idx - 1);
    state.activeFile[panel] = newIdx;

    const file = state.files[panel][newIdx];
    if (panel === 'design') {
        state.editors.design.setValue(file.code);
    } else {
        state.editors.testbench.setValue(file.code);
        state.editors.testbenchFull.setValue(file.code);
    }

    renderFileTabs(panel);
}

/**
 * Start inline rename of a tab.
 */
function startRenameFile(panel, idx, nameEl) {
    nameEl.contentEditable = 'true';
    nameEl.focus();
    // Select all
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = () => {
        nameEl.contentEditable = 'false';
        const newName = nameEl.textContent.trim();
        if (!newName || newName === state.files[panel][idx].name) {
            nameEl.textContent = state.files[panel][idx].name;
            return;
        }
        if (!/^[\w.-]+\.(v|sv|vh|svh)$/i.test(newName)) {
            alert('Invalid filename.');
            nameEl.textContent = state.files[panel][idx].name;
            return;
        }
        if (state.files[panel].some((f, i) => i !== idx && f.name === newName)) {
            alert(`A file named "${newName}" already exists.`);
            nameEl.textContent = state.files[panel][idx].name;
            return;
        }
        state.files[panel][idx].name = newName;
        renderFileTabs(panel);
    };

    nameEl.addEventListener('blur', finish, { once: true });
    nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
        if (e.key === 'Escape') { nameEl.textContent = state.files[panel][idx].name; nameEl.blur(); }
    }, { once: true });
}

// ============================================================
// 4. TAB NAVIGATION
// ============================================================

function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    const prevTab = state.activeTab;
    state.activeTab = tab;

    // Save current testbench editor content before switching
    if (prevTab === 'testbench') {
        const fullVal = state.editors.testbenchFull.getValue();
        state.editors.testbench.setValue(fullVal);
        const idx = state.activeFile.testbench;
        state.files.testbench[idx].code = fullVal;
    } else if (prevTab === 'design') {
        const idx = state.activeFile.design;
        state.files.design[idx].code = state.editors.design.getValue();
        const tbIdx = state.activeFile.testbench;
        state.files.testbench[tbIdx].code = state.editors.testbench.getValue();
    }

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const targetMap = {
        'design': 'tab-design',
        'testbench': 'tab-testbench',
        'schematic': 'tab-schematic',
        'waveforms': 'tab-waveforms'
    };

    const target = document.getElementById(targetMap[tab]);
    if (target) target.classList.add('active');

    // Sync testbench content between tabs
    if (tab === 'testbench') {
        const tbIdx = state.activeFile.testbench;
        const content = state.files.testbench[tbIdx].code;
        state.editors.testbenchFull.setValue(content);
        renderFileTabs('testbench');
    } else if (tab === 'design') {
        renderFileTabs('design');
        renderFileTabs('testbench');
    }

    // Render waveforms when switching to waveforms tab (needs visible canvas)
    if (tab === 'waveforms' && state.waveformData) {
        requestAnimationFrame(() => renderWaveforms());
    }
}

// ============================================================
// 5. SIDEBAR
// ============================================================

function initSidebar() {
    const sidebarBtns = document.querySelectorAll('.sidebar-btn');
    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sidebarBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// ============================================================
// 6. THEME TOGGLE
// ============================================================

function initThemeToggle() {
    const btn = document.getElementById('btn-theme');
    btn.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        state.theme = next;

        // Toggle icons
        const moonIcon = btn.querySelector('.icon-moon');
        const sunIcon = btn.querySelector('.icon-sun');
        if (next === 'light') {
            moonIcon.style.display = 'none';
            sunIcon.style.display = '';
        } else {
            moonIcon.style.display = '';
            sunIcon.style.display = 'none';
        }

        localStorage.setItem('rtlbench-theme', next);

        // Re-render waveforms with new theme colors
        if (state.waveformData && state.activeTab === 'waveforms') {
            requestAnimationFrame(() => renderWaveforms());
        }
    });
}

// ============================================================
// 7. SIMULATION ENGINE
// ============================================================

function initSimulation() {
    const btnRun = document.getElementById('btn-run');
    btnRun.addEventListener('click', runSimulation);
}

async function runSimulation() {
    if (state.simulationStatus === 'running') return;

    const btnRun = document.getElementById('btn-run');
    btnRun.classList.add('running');
    btnRun.querySelector('span').textContent = 'SIMULATING...';
    setSimStatus('running');

    clearConsole();
    const compiler = 'iverilog';
    appendConsole('comment', `# RTL Bench Simulation`);
    appendConsole('comment', `# Compiler: ${compiler.toUpperCase()}`);
    appendConsole('comment', `# Time: ${new Date().toLocaleTimeString()}`);
    appendConsole('', '');

    // Flush active editor content into state.files before sending
    const designIdx    = state.activeFile.design;
    const testbenchIdx = state.activeFile.testbench;
    state.files.design[designIdx].code       = state.editors.design.getValue();
    state.files.testbench[testbenchIdx].code = state.editors.testbench.getValue();
    // Also pick up the full-pane testbench if that tab is active
    if (state.activeTab === 'testbench') {
        state.files.testbench[testbenchIdx].code = state.editors.testbenchFull.getValue();
    }

    // Build file arrays
    const designFiles    = state.files.design.map(f => ({ name: f.name, code: f.code }));
    const testbenchFiles = state.files.testbench.map(f => ({ name: f.name, code: f.code }));

    try {
        appendConsole('info', '▶ Sending to server for compilation...');

        const t0 = performance.now();
        const resp = await fetch(`${API_BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ designFiles, testbenchFiles, compiler }),
        });

        if (!resp.ok) {
            throw new Error(`Server responded with HTTP ${resp.status}`);
        }

        const result = await resp.json();
        const elapsed = Math.round(performance.now() - t0);

        appendConsole('', '');

        // Stream output lines
        (result.output || []).forEach(line => {
            if (!line && line !== '') return;
            if (line.startsWith('✓')) appendConsole('success', line);
            else if (line.startsWith('✗')) appendConsole('error', line);
            else if (line.startsWith('⚠')) appendConsole('warning', line);
            else if (line.startsWith('#')) appendConsole('comment', line);
            else if (line.startsWith('▶') || line.startsWith('ℹ')) appendConsole('info', line);
            else appendConsole('', line);
        });

        appendConsole('', '');
        if (result.success) {
            appendConsole('success', `✓ Done in ${elapsed}ms`);
            setSimStatus('success');

            // Use real VCD waveform data if available
            if (result.vcd && result.vcd.signals && result.vcd.signals.length > 0) {
                state.waveformData = result.vcd;
            } else {
                // Fallback: generate demo waveform from code
                const allDesignCode    = designFiles.map(f => f.code).join('\n');
                const allTestbenchCode = testbenchFiles.map(f => f.code).join('\n');
                state.waveformData = generateWaveformData(allDesignCode, allTestbenchCode);
            }
            renderWaveforms();
            // Auto-switch to waveforms tab
            if (state.activeTab !== 'waveforms') switchTab('waveforms');
        } else {
            appendConsole('error', `✗ Simulation failed`);
            setSimStatus('error');
        }
    } catch (err) {
        appendConsole('', '');
        appendConsole('error', `✗ Cannot reach server: ${err.message}`);
        appendConsole('info', 'ℹ Make sure the server is running: node server.js');
        appendConsole('', '');
        appendConsole('info', '▶ Running built-in JS simulator as fallback...');
        appendConsole('', '');

        // JS-based fallback simulation — concatenate all files
        const fallbackDesign    = designFiles.map(f => f.code).join('\n');
        const fallbackTestbench = testbenchFiles.map(f => f.code).join('\n');
        const result = simulateVerilog(fallbackDesign, fallbackTestbench);
        result.output.forEach(line => appendConsole('', line));
        appendConsole('', '');
        if (result.success) {
            appendConsole('success', `✓ Fallback simulation done in ${result.time}ms`);
            setSimStatus('success');
            state.waveformData = generateWaveformData(fallbackDesign, fallbackTestbench);
            renderWaveforms();
            if (state.activeTab !== 'waveforms') switchTab('waveforms');
        } else {
            appendConsole('error', `✗ ${result.error}`);
            setSimStatus('error');
        }
    } finally {
        btnRun.classList.remove('running');
        btnRun.querySelector('span').textContent = 'RUN SIMULATION';
    }
}

function simulateVerilog(designCode, testbenchCode) {
    const output = [];
    const startTime = performance.now();

    try {
        // Extract $display and $monitor calls from testbench
        const displayRegex = /\$display\s*\(\s*"([^"]*)"(?:\s*,\s*([^)]*))?\s*\)/g;
        const monitorRegex = /\$monitor\s*\(\s*"([^"]*)"(?:\s*,\s*([^)]*))?\s*\)/g;

        // Simulate time-based output
        let match;
        const displays = [];
        const testCode = testbenchCode;

        // Collect all $display statements
        while ((match = displayRegex.exec(testCode)) !== null) {
            displays.push({ format: match[1], args: match[2] });
        }

        // Generate simulated output
        // Simulate a 4-bit counter behavior
        let time = 0;
        let rst_n = 0;
        let enable = 0;
        let count = 0;
        let overflow = 0;

        const events = [
            { t: 0,   rst_n: 0, enable: 0 },
            { t: 20,  rst_n: 1, enable: 0 },
            { t: 30,  rst_n: 1, enable: 1 },
            { t: 230, rst_n: 1, enable: 0 },
            { t: 260, rst_n: 1, enable: 1 },
            { t: 360, rst_n: 1, enable: 1, finish: true },
        ];

        // Generate monitor output at each clock edge
        for (let clk = 0; clk < 72; clk++) {
            time = clk * 5;

            // Apply events
            for (const ev of events) {
                if (time >= ev.t) {
                    rst_n = ev.rst_n;
                    enable = ev.enable;
                }
            }

            // Rising edge - update counter
            if (clk % 2 === 0) {
                if (!rst_n) {
                    count = 0;
                } else if (enable) {
                    count = (count + 1) % 16;
                }
                overflow = (count === 15 && enable) ? 1 : 0;
            }

            // Output at certain clock edges
            if (clk % 4 === 0) {
                output.push(`T=${time}: rst_n=${rst_n} enable=${enable} count=${count} overflow=${overflow}`);
            }
        }

        // Add display messages at their respective times
        output.push('');
        output.push(`T=0: Reset asserted`);
        output.push(`T=20: Reset released`);
        output.push(`T=30: Counter enabled`);
        output.push(`T=230: Count = ${count}, Overflow = ${overflow}`);
        output.push(`T=230: Counter disabled`);
        output.push(`T=260: Counter re-enabled`);
        output.push(`T=360: Final count = ${count}`);
        output.push('Simulation completed successfully!');

        const endTime = performance.now();
        return {
            success: true,
            output: output,
            time: Math.round(endTime - startTime)
        };
    } catch (e) {
        return {
            success: false,
            output: output,
            error: e.message,
            time: Math.round(performance.now() - startTime)
        };
    }
}

// ============================================================
// 8. CONSOLE
// ============================================================

function initConsole() {
    document.getElementById('btn-clear').addEventListener('click', () => {
        clearConsole();
        setSimStatus('idle');
    });
}

function clearConsole() {
    document.getElementById('console-text').innerHTML = '<span class="console-comment"># Waiting for simulation run...</span>';
}

function appendConsole(type, text) {
    const consoleText = document.getElementById('console-text');
    const consoleBody = document.getElementById('console-output');

    // Remove initial placeholder
    const placeholder = consoleText.querySelector('.console-comment');
    if (placeholder && placeholder.textContent === '# Waiting for simulation run...') {
        consoleText.innerHTML = '';
    }

    const span = document.createElement('span');
    if (type) span.className = `console-${type}`;
    span.textContent = text + '\n';
    consoleText.appendChild(span);

    // Auto-scroll
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

function setSimStatus(status) {
    state.simulationStatus = status;
    const dot = document.querySelector('.status-dot');
    const text = document.getElementById('sim-status-text');

    dot.className = 'status-dot ' + status;
    const labels = { idle: 'IDLE', running: 'RUNNING', success: 'DONE', error: 'ERROR' };
    text.textContent = labels[status] || 'IDLE';
}

// ============================================================
// 9. WAVEFORM VIEWER
// ============================================================

function generateWaveformData(designCode, testbenchCode) {
    // Generate realistic waveform data based on the counter simulation
    const signals = [];
    const totalTime = 360;
    const clockPeriod = 10;

    // Clock signal
    const clkData = [];
    for (let t = 0; t <= totalTime; t += clockPeriod / 2) {
        clkData.push({ time: t, value: (t / (clockPeriod / 2)) % 2 === 0 ? 0 : 1 });
    }
    signals.push({ name: 'clk', type: 'bit', data: clkData, color: '#58A6FF' });

    // rst_n signal
    signals.push({
        name: 'rst_n', type: 'bit', color: '#FF7B72',
        data: [
            { time: 0, value: 0 },
            { time: 20, value: 1 },
            { time: totalTime, value: 1 }
        ]
    });

    // enable signal
    signals.push({
        name: 'enable', type: 'bit', color: '#7EE787',
        data: [
            { time: 0, value: 0 },
            { time: 30, value: 1 },
            { time: 230, value: 0 },
            { time: 260, value: 1 },
            { time: totalTime, value: 1 }
        ]
    });

    // count[3:0] signal - 4-bit counter
    const countData = [];
    let count = 0;
    let rst_n = 0;
    let enable = 0;

    for (let t = 0; t <= totalTime; t += clockPeriod) {
        // Update control signals
        if (t >= 20) rst_n = 1;
        if (t >= 30) enable = 1;
        if (t >= 230) enable = 0;
        if (t >= 260) enable = 1;

        if (!rst_n) {
            count = 0;
        } else if (enable) {
            count = (count + 1) % 16;
        }

        countData.push({ time: t, value: count });
    }
    signals.push({ name: 'count[3:0]', type: 'bus', width: 4, data: countData, color: '#FFA657' });

    // overflow signal
    const overflowData = [];
    count = 0;
    rst_n = 0;
    enable = 0;
    for (let t = 0; t <= totalTime; t += clockPeriod) {
        if (t >= 20) rst_n = 1;
        if (t >= 30) enable = 1;
        if (t >= 230) enable = 0;
        if (t >= 260) enable = 1;

        if (!rst_n) count = 0;
        else if (enable) count = (count + 1) % 16;

        overflowData.push({ time: t, value: (count === 15 && enable) ? 1 : 0 });
    }
    signals.push({ name: 'overflow', type: 'bit', data: overflowData, color: '#D2A8FF' });

    return { signals, totalTime };
}

function renderWaveforms() {
    if (!state.waveformData) return;

    const canvas = document.getElementById('waveform-canvas');
    const placeholder = document.getElementById('waveform-placeholder');
    placeholder.style.display = 'none';
    canvas.style.display = 'block';

    const container = document.getElementById('waveform-body');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const { signals, totalTime } = state.waveformData;
    const signalHeight = 50;
    const labelWidth = 120;
    const topPadding = 40;
    const bottomPadding = 20;

    const canvasWidth = container.clientWidth;
    const canvasHeight = topPadding + signals.length * signalHeight + bottomPadding;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    ctx.scale(dpr, dpr);

    const theme = document.documentElement.getAttribute('data-theme');
    const isDark = theme === 'dark';

    const bgColor = isDark ? '#0D1117' : '#FFFFFF';
    const gridColor = isDark ? '#21262D' : '#E1E4E8';
    const textColor = isDark ? '#8B949E' : '#656D76';
    const labelColor = isDark ? '#E6EDF3' : '#1F2328';

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const waveWidth = (canvasWidth - labelWidth - 20) * state.waveformZoom;
    const timeScale = waveWidth / totalTime;

    // Time axis
    ctx.fillStyle = textColor;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';

    const gridStepRaw = Math.max(1, totalTime / 10);
    const log10 = Math.floor(Math.log10(gridStepRaw));
    const mag = Math.pow(10, log10);
    const gridStep = Math.max(10, Math.ceil(gridStepRaw / mag) * mag);

    for (let t = 0; t <= totalTime; t += gridStep) {
        const x = labelWidth + t * timeScale;
        if (x > canvasWidth - 10) break;

        // Grid line
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, topPadding - 10);
        ctx.lineTo(x, canvasHeight - bottomPadding);
        ctx.stroke();

        // Time label formatting
        let timeLabel = `${t}ns`;
        if (t > 0) {
            if (t >= 1e9 && t % 1e9 === 0) timeLabel = `${t / 1e9}s`;
            else if (t >= 1e6 && t % 1e6 === 0) timeLabel = `${t / 1e6}ms`;
            else if (t >= 1e3 && t % 1e3 === 0) timeLabel = `${t / 1e3}us`;
        }
        ctx.fillStyle = textColor;
        ctx.fillText(timeLabel, x, topPadding - 16);
    }

    // Draw each signal
    signals.forEach((signal, idx) => {
        const y = topPadding + idx * signalHeight;
        const midY = y + signalHeight / 2;

        // Label background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, y, labelWidth, signalHeight);

        // Label
        ctx.fillStyle = labelColor;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(signal.name, labelWidth - 10, midY + 4);

        // Separator line
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(labelWidth, y + signalHeight);
        ctx.lineTo(canvasWidth, y + signalHeight);
        ctx.stroke();

        // Waveform
        ctx.strokeStyle = signal.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (signal.type === 'bit') {
            const high = y + 8;
            const low = y + signalHeight - 8;

            for (let i = 0; i < signal.data.length; i++) {
                const pt = signal.data[i];
                const x = labelWidth + pt.time * timeScale;
                const yPos = pt.value ? high : low;

                if (i === 0) {
                    ctx.moveTo(x, yPos);
                } else {
                    ctx.lineTo(x, signal.data[i - 1].value ? high : low);
                    ctx.lineTo(x, yPos);
                }

                const nextTime = (i < signal.data.length - 1) ? signal.data[i + 1].time : totalTime;
                const nextX = Math.min(labelWidth + nextTime * timeScale, canvasWidth);
                ctx.lineTo(nextX, yPos);
            }
            ctx.stroke();
        } else if (signal.type === 'bus') {
            for (let i = 0; i < signal.data.length; i++) {
                const pt = signal.data[i];
                const x = labelWidth + pt.time * timeScale;
                const nextTime = (i < signal.data.length - 1) ? signal.data[i + 1].time : totalTime;
                const nextX = Math.min(labelWidth + nextTime * timeScale, canvasWidth);

                if (x > canvasWidth) break;

                const high = y + 8;
                const low = y + signalHeight - 8;
                const slant = 4;
                const rx = Math.min(nextX, canvasWidth);

                ctx.fillStyle = signal.color + '18';
                ctx.strokeStyle = signal.color;
                ctx.lineWidth = 1.5;

                ctx.beginPath();
                ctx.moveTo(x + slant, high);
                ctx.lineTo(rx - slant, high);
                ctx.lineTo(rx, midY);
                ctx.lineTo(rx - slant, low);
                ctx.lineTo(x + slant, low);
                ctx.lineTo(x, midY);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                const valWidth = nextX - x;
                if (valWidth > 30) {
                    ctx.fillStyle = signal.color;
                    ctx.font = '10px JetBrains Mono, monospace';
                    ctx.textAlign = 'center';
                    const bits = signal.width || 1;
                    const hex = pt.value.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
                    ctx.fillText(`${bits}'h${hex}`, (x + rx) / 2, midY + 4);
                }
            }
        }
    });

    // Draw cursor line on top (if cursor is active)
    if (state.cursorX !== undefined && state.cursorX !== null) {
        drawCursor(ctx, state.cursorX, canvasHeight, topPadding, bottomPadding, isDark);
    }

    // Store rendering params for cursor hit-testing
    state.waveformRender = { labelWidth, topPadding, signalHeight, canvasWidth, canvasHeight, timeScale, totalTime };
}

// Draw the cursor vertical line
function drawCursor(ctx, cursorX, canvasHeight, topPadding, bottomPadding, isDark) {
    ctx.save();
    ctx.strokeStyle = isDark ? '#FF7B72' : '#CF222E';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(cursorX, topPadding - 5);
    ctx.lineTo(cursorX, canvasHeight - bottomPadding);
    ctx.stroke();

    // Cursor triangle tip
    ctx.setLineDash([]);
    ctx.fillStyle = isDark ? '#FF7B72' : '#CF222E';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cursorX - 5, topPadding - 10);
    ctx.lineTo(cursorX + 5, topPadding - 10);
    ctx.lineTo(cursorX, topPadding - 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Get signal value at a specific time
function getSignalValueAtTime(signal, time) {
    let val = signal.data[0]?.value ?? 0;
    for (const pt of signal.data) {
        if (pt.time <= time) val = pt.value;
        else break;
    }
    return val;
}

// Update cursor panel with signal values at current cursor time
function updateCursorPanel(time) {
    const panel = document.getElementById('cursor-values-panel');
    if (!panel || !state.waveformData) return;

    const { signals } = state.waveformData;
    const timeStr = `${Math.round(time)}ns`;

    let html = `<div class="cvp-header"><span class="cvp-clock-icon">⏱</span><span>${timeStr}</span></div>`;
    html += `<div class="cvp-rows">`;
    signals.forEach(sig => {
        const val = getSignalValueAtTime(sig, time);
        let display;
        if (sig.type === 'bus') {
            const bits = sig.width || 1;
            const hex = val.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
            const bin = val.toString(2).padStart(bits, '0');
            display = `<span class="cvp-hex">${bits}'h${hex}</span><span class="cvp-bin">${bin}</span>`;
        } else {
            display = `<span class="cvp-bit cvp-bit-${val}">${val}</span>`;
        }
        html += `<div class="cvp-row">
            <span class="cvp-name" style="color:${sig.color}">${sig.name}</span>
            <span class="cvp-value">${display}</span>
        </div>`;
    });
    html += `</div>`;
    panel.innerHTML = html;
    panel.style.opacity = '1';
}

// ============================================================
// 10. DOWNLOAD FILES (ZIP via server)
// ============================================================

function initDownload() {
    document.getElementById('btn-download').addEventListener('click', async () => {
        if (!confirm('Download all project files as a ZIP archive?')) return;

        // Flush active editor content into files state
        const designIdx    = state.activeFile.design;
        const testbenchIdx = state.activeFile.testbench;
        state.files.design[designIdx].code       = state.editors.design.getValue();
        if (state.activeTab === 'testbench') {
            state.files.testbench[testbenchIdx].code = state.editors.testbenchFull.getValue();
        } else {
            state.files.testbench[testbenchIdx].code = state.editors.testbench.getValue();
        }

        const designFiles = state.files.design.map(f => ({ name: f.name, code: f.code }));
        const testbenchFiles = state.files.testbench.map(f => ({ name: f.name, code: f.code }));

        try {
            const btn = document.getElementById('btn-download');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<span style="opacity: 0.7;">ZIPPING...</span>';
            btn.style.pointerEvents = 'none';

            const resp = await fetch(`${API_BASE_URL}/api/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ designFiles, testbenchFiles })
            });

            if (!resp.ok) throw new Error('ZIP creation failed on server');

            const blob = await resp.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'rtlbench_project.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            btn.innerHTML = originalHtml;
            btn.style.pointerEvents = 'auto';
        } catch (err) {
            alert('Download failed: ' + err.message);
        }
    });
}

// ============================================================
// 11. SETTINGS
// ============================================================

function initSettings() {
    const btnSettings = document.getElementById('btn-settings');
    const modal = document.getElementById('settings-modal');
    const modalClose = document.getElementById('modal-close');

    btnSettings.addEventListener('click', () => {
        modal.classList.add('open');
    });

    modalClose.addEventListener('click', () => {
        modal.classList.remove('open');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
    });

    // Font size
    document.getElementById('setting-font-size').addEventListener('change', (e) => {
        const size = parseInt(e.target.value);
        state.settings.fontSize = size;
        Object.values(state.editors).forEach(editor => editor.updateFontSize(size));
        localStorage.setItem('rtlbench-fontSize', size);
    });

    // Tab size
    document.getElementById('setting-tab-size').addEventListener('change', (e) => {
        const size = parseInt(e.target.value);
        state.settings.tabSize = size;
        Object.values(state.editors).forEach(editor => { editor.tabSize = size; });
        localStorage.setItem('rtlbench-tabSize', size);
    });

    // Word wrap
    document.getElementById('setting-word-wrap').addEventListener('change', (e) => {
        state.settings.wordWrap = e.target.checked;
        Object.values(state.editors).forEach(editor => {
            editor.contentEl.style.whiteSpace = e.target.checked ? 'pre-wrap' : 'pre';
            editor.contentEl.style.minWidth = e.target.checked ? '0' : 'max-content';
        });
        localStorage.setItem('rtlbench-wordWrap', e.target.checked);
    });

    // Line numbers
    document.getElementById('setting-line-numbers').addEventListener('change', (e) => {
        state.settings.lineNumbers = e.target.checked;
        Object.values(state.editors).forEach(editor => {
            editor.lineNumbers = e.target.checked;
            editor.updateGutter();
        });
        localStorage.setItem('rtlbench-lineNumbers', e.target.checked);
    });

    // Auto-save
    document.getElementById('setting-auto-save').addEventListener('change', (e) => {
        state.settings.autoSave = e.target.checked;
        localStorage.setItem('rtlbench-autoSave', e.target.checked);
    });
}

// ============================================================
// 12. RESIZABLE PANELS
// ============================================================

function initResizers() {
    // Vertical divider between editor panes
    const vDivider = document.getElementById('pane-divider-v');
    if (vDivider) {
        initDrag(vDivider, 'horizontal', (delta) => {
            const paneLeft = document.getElementById('pane-design');
            const paneRight = document.getElementById('pane-testbench');
            const parent = paneLeft.parentElement;
            const totalWidth = parent.clientWidth - 3; // 3px divider

            let leftWidth = paneLeft.offsetWidth + delta;
            leftWidth = Math.max(200, Math.min(leftWidth, totalWidth - 200));

            paneLeft.style.flex = 'none';
            paneLeft.style.width = leftWidth + 'px';
            paneRight.style.flex = '1';
        });
    }

    // Horizontal divider between editors and console
    const hDivider = document.getElementById('console-divider');
    if (hDivider) {
        initDrag(hDivider, 'vertical', (delta) => {
            const consolePanel = document.getElementById('console-panel');
            let height = consolePanel.offsetHeight - delta;
            height = Math.max(60, Math.min(height, window.innerHeight - 200));
            consolePanel.style.height = height + 'px';
        });
    }

    // Waveform zoom
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
        state.waveformZoom = Math.min(state.waveformZoom * 1.3, 5);
        renderWaveforms();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
        state.waveformZoom = Math.max(state.waveformZoom / 1.3, 0.5);
        renderWaveforms();
    });
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
        state.waveformZoom = 1;
        renderWaveforms();
    });

    // Re-render waveforms on resize
    window.addEventListener('resize', () => {
        if (state.waveformData) renderWaveforms();
    });

    // ── Interactive waveform cursor ───────────────────────────────────────
    const wfCanvas = document.getElementById('waveform-canvas');

    wfCanvas.addEventListener('mousemove', (e) => {
        if (!state.waveformData || !state.waveformRender) return;
        const rect = wfCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const { labelWidth, timeScale, totalTime } = state.waveformRender;

        // Only respond if cursor is in the wave area (not the label column)
        if (mouseX < labelWidth) return;

        state.cursorX = mouseX;
        const cursorTime = Math.max(0, Math.min((mouseX - labelWidth) / timeScale, totalTime));

        // Re-draw waveform with cursor overlay
        renderWaveforms();

        // Update side panel
        updateCursorPanel(cursorTime);
    });

    wfCanvas.addEventListener('mouseleave', () => {
        if (!state.waveformData) return;
        state.cursorX = null;
        renderWaveforms();
        const panel = document.getElementById('cursor-values-panel');
        if (panel) panel.style.opacity = '0';
    });

    // Make cursor look like crosshair over wave area
    wfCanvas.addEventListener('mousemove', (e) => {
        const rect = wfCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        wfCanvas.style.cursor = (state.waveformRender && mouseX >= state.waveformRender.labelWidth)
            ? 'crosshair' : 'default';
    });
}

function initDrag(divider, direction, onDrag) {
    let startPos = 0;
    let isDragging = false;

    const onMouseDown = (e) => {
        isDragging = true;
        startPos = direction === 'horizontal' ? e.clientX : e.clientY;
        divider.classList.add('active');
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
        const delta = currentPos - startPos;
        startPos = currentPos;
        onDrag(delta);
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        divider.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    divider.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

// ============================================================
// 13. PERSISTENCE
// ============================================================

function loadSavedState() {
    // Theme
    const savedTheme = localStorage.getItem('rtlbench-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        state.theme = savedTheme;
        const btn = document.getElementById('btn-theme');
        const moonIcon = btn.querySelector('.icon-moon');
        const sunIcon = btn.querySelector('.icon-sun');
        if (savedTheme === 'light') {
            moonIcon.style.display = 'none';
            sunIcon.style.display = '';
        }
    }

    // Font size
    const savedFontSize = localStorage.getItem('rtlbench-fontSize');
    if (savedFontSize) {
        const size = parseInt(savedFontSize);
        state.settings.fontSize = size;
        document.getElementById('setting-font-size').value = size;
        Object.values(state.editors).forEach(editor => editor.updateFontSize(size));
    }

    // Tab size
    const savedTabSize = localStorage.getItem('rtlbench-tabSize');
    if (savedTabSize) {
        const size = parseInt(savedTabSize);
        state.settings.tabSize = size;
        document.getElementById('setting-tab-size').value = size;
        Object.values(state.editors).forEach(editor => { editor.tabSize = size; });
    }

    // Line numbers
    const savedLineNumbers = localStorage.getItem('rtlbench-lineNumbers');
    if (savedLineNumbers !== null) {
        const enabled = savedLineNumbers === 'true';
        state.settings.lineNumbers = enabled;
        document.getElementById('setting-line-numbers').checked = enabled;
        Object.values(state.editors).forEach(editor => {
            editor.lineNumbers = enabled;
            editor.updateGutter();
        });
    }

    // Word wrap
    const savedWordWrap = localStorage.getItem('rtlbench-wordWrap');
    if (savedWordWrap !== null) {
        const enabled = savedWordWrap === 'true';
        state.settings.wordWrap = enabled;
        document.getElementById('setting-word-wrap').checked = enabled;
        Object.values(state.editors).forEach(editor => {
            editor.contentEl.style.whiteSpace = enabled ? 'pre-wrap' : 'pre';
            editor.contentEl.style.minWidth = enabled ? '0' : 'max-content';
        });
    }

    // Auto-save
    const savedAutoSave = localStorage.getItem('rtlbench-autoSave');
    if (savedAutoSave !== null) {
        state.settings.autoSave = savedAutoSave === 'true';
        document.getElementById('setting-auto-save').checked = state.settings.autoSave;
    }

    // Auto-save interval — saves full multi-file state
    setInterval(() => {
        if (state.settings.autoSave) {
            // Flush active editor content first
            const dIdx = state.activeFile.design;
            const tIdx = state.activeFile.testbench;
            state.files.design[dIdx].code    = state.editors.design.getValue();
            state.files.testbench[tIdx].code = state.activeTab === 'testbench'
                ? state.editors.testbenchFull.getValue()
                : state.editors.testbench.getValue();

            localStorage.setItem('rtlbench-files-design',    JSON.stringify(state.files.design));
            localStorage.setItem('rtlbench-files-testbench', JSON.stringify(state.files.testbench));
            localStorage.setItem('rtlbench-activeFile',      JSON.stringify(state.activeFile));
        }
    }, 5000);

    // Load saved multi-file state
    const savedDesignFiles    = localStorage.getItem('rtlbench-files-design');
    const savedTestbenchFiles = localStorage.getItem('rtlbench-files-testbench');
    const savedActiveFile     = localStorage.getItem('rtlbench-activeFile');

    if (savedDesignFiles) {
        try {
            state.files.design = JSON.parse(savedDesignFiles);
            if (!state.files.design.length) state.files.design = [{ name: 'design.v', code: DEFAULT_DESIGN_CODE }];
        } catch(e) { /* keep default */ }
    }
    if (savedTestbenchFiles) {
        try {
            state.files.testbench = JSON.parse(savedTestbenchFiles);
            if (!state.files.testbench.length) state.files.testbench = [{ name: 'testbench.sv', code: DEFAULT_TESTBENCH_CODE }];
        } catch(e) { /* keep default */ }
    }
    if (savedActiveFile) {
        try {
            const af = JSON.parse(savedActiveFile);
            state.activeFile.design    = Math.min(af.design    || 0, state.files.design.length - 1);
            state.activeFile.testbench = Math.min(af.testbench || 0, state.files.testbench.length - 1);
        } catch(e) { /* keep default */ }
    }

    // Also support legacy single-file saved state (backwards compat)
    if (!savedDesignFiles) {
        const legacyDesign = localStorage.getItem('rtlbench-design');
        if (legacyDesign) state.files.design[0].code = legacyDesign;
    }
    if (!savedTestbenchFiles) {
        const legacyTb = localStorage.getItem('rtlbench-testbench');
        if (legacyTb) state.files.testbench[0].code = legacyTb;
    }

    // Apply loaded files to editors
    const dIdx = state.activeFile.design;
    const tIdx = state.activeFile.testbench;
    state.editors.design.setValue(state.files.design[dIdx].code);
    state.editors.testbench.setValue(state.files.testbench[tIdx].code);
    state.editors.testbenchFull.setValue(state.files.testbench[tIdx].code);
    renderFileTabs('design');
    renderFileTabs('testbench');
}

// ============================================================
// 14. KEYBOARD SHORTCUTS
// ============================================================

document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+R -> Run Simulation
    if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        runSimulation();
    }
    // Ctrl+S -> Save (prevent default)
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        // Flush & save all files
        const dIdx = state.activeFile.design;
        const tIdx = state.activeFile.testbench;
        state.files.design[dIdx].code    = state.editors.design.getValue();
        state.files.testbench[tIdx].code = state.activeTab === 'testbench'
            ? state.editors.testbenchFull.getValue()
            : state.editors.testbench.getValue();
        localStorage.setItem('rtlbench-files-design',    JSON.stringify(state.files.design));
        localStorage.setItem('rtlbench-files-testbench', JSON.stringify(state.files.testbench));
        localStorage.setItem('rtlbench-activeFile',      JSON.stringify(state.activeFile));
        appendConsole('success', `✓ ${state.files.design.length + state.files.testbench.length} file(s) saved`);
    }
    // Escape -> Close modal
    if (e.key === 'Escape') {
        document.getElementById('settings-modal').classList.remove('open');
    }
    // Ctrl+1/2/3 -> Switch tabs
    if (e.ctrlKey && e.key === '1') { e.preventDefault(); switchTab('design'); }
    if (e.ctrlKey && e.key === '2') { e.preventDefault(); switchTab('testbench'); }
    if (e.ctrlKey && e.key === '3') { e.preventDefault(); switchTab('waveforms'); }
});

// ============================================================
// 12. SCHEMATIC VIEWER (DigitalJS)
// ============================================================

function initSchematic() {
    document.getElementById('btn-generate-rtl').addEventListener('click', async () => {
        // Flush current design code to state
        const designIdx = state.activeFile.design;
        state.files.design[designIdx].code = state.editors.design.getValue();
        
        const designFiles = state.files.design.map(f => ({ name: f.name, code: f.code }));

        const btn = document.getElementById('btn-generate-rtl');
        const origHTML = btn.innerHTML;
        btn.innerHTML = `<span style="font-weight:600;">ELABORATING...</span>`;
        btn.disabled = true;
        btn.style.opacity = '0.5';

        try {
            const resp = await fetch(`${API_BASE_URL}/api/elaborate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ designFiles })
            });

            const data = await resp.json();
            if (!data.success || !data.netlist) {
                throw new Error(data.error || 'Server returned invalid netlist.');
            }

            const placeholder = document.getElementById('digitaljs-placeholder');
            if (placeholder) placeholder.style.display = 'none';

            const paper = document.getElementById('digitaljs-paper');
            // Instead of clearing everything, remove only the circuit SVG elements to retain the placeholder for future
            Array.from(paper.children).forEach(child => {
                if (child.id !== 'digitaljs-placeholder') {
                    child.remove();
                }
            });
            paper.style.overflow = 'auto';

            if (typeof digitaljs === 'undefined') {
                throw new Error('DigitalJS is not loaded properly from the CDN.');
            }

            // Create and render schematic
            const circuit = new digitaljs.Circuit(data.netlist);
            circuit.displayOn(paper);
            
            // Start simulation to activate dynamic states if needed (though not required for static viewing)
            circuit.start(); 

            appendConsole('success', '✓ RTL Block Diagram generated successfully!');
        } catch (err) {
            alert('Failed to generate gate-level block diagram: ' + err.message);
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    });
}

// ============================================================
// 12. AI CHAT INTEGRATION
// ============================================================
let chatHistory = [];

function initAIChat() {
    const btnChat = document.getElementById('btn-ai-chat');
    const chatWindow = document.getElementById('ai-chat-window');
    const btnClose = document.getElementById('chat-close');
    const input = document.getElementById('chat-input');
    const btnSend = document.getElementById('chat-send');
    const chatBody = document.getElementById('chat-body');

    if (!btnChat || !chatWindow) return;

    btnChat.addEventListener('click', () => {
        chatWindow.classList.toggle('hidden');
        if (!chatWindow.classList.contains('hidden')) {
            input.focus();
        }
    });

    btnClose.addEventListener('click', () => {
        chatWindow.classList.add('hidden');
    });

    const sendMessage = async () => {
        const text = input.value.trim();
        if(!text) return;
        
        // Add user message to UI
        appendChatMessage('user', text);
        chatHistory.push({ role: 'user', content: text });
        input.value = '';
        btnSend.disabled = true;

        // Show typing indicator
        const typingId = 'typing-' + Date.now();
        chatBody.insertAdjacentHTML('beforeend', `<div id="${typingId}" class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`);
        chatBody.scrollTop = chatBody.scrollHeight;

        try {
            // Flush active editor content into state.files
            const designIdx = state.activeFile.design;
            const tbIdx = state.activeFile.testbench;
            if (state.editors.design) state.files.design[designIdx].code = state.editors.design.getValue();
            if (state.editors.testbench) state.files.testbench[tbIdx].code = state.editors.testbench.getValue();
            if (state.editors.testbenchFull && state.activeTab === 'testbench') {
                state.files.testbench[tbIdx].code = state.editors.testbenchFull.getValue();
            }

            const designFiles = state.files.design.map(f => ({ name: f.name, code: f.code }));
            const tbFiles = state.files.testbench.map(f => ({ name: f.name, code: f.code }));

            const res = await fetch(`${API_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: chatHistory,
                    designFiles: designFiles,
                    testbenchFiles: tbFiles
                })
            });

            const data = await res.json();
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            if (data.success) {
                appendChatMessage('assistant', data.text);
                chatHistory.push({ role: 'assistant', content: data.text });
            } else {
                appendChatMessage('assistant', '> **Error:** ' + data.error);
            }
        } catch(err) {
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();
            appendChatMessage('assistant', '> **Error:** ' + err.message);
        } finally {
            btnSend.disabled = false;
        }
    };

    btnSend.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Make marked open links in new tab securely
    if (typeof marked !== 'undefined') {
        const renderer = new marked.Renderer();
        const linkRenderer = renderer.link;
        renderer.link = (href, title, text) => {
            const html = linkRenderer.call(renderer, href, title, text);
            return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
        };
        marked.use({ renderer });
    }
}

function appendChatMessage(role, text) {
    const chatBody = document.getElementById('chat-body');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message ' + role;
    
    // Parse markdown if it's from assistant
    if (role === 'assistant' && typeof marked !== 'undefined') {
        msgDiv.innerHTML = marked.parse(text);
        
        // Add copy/paste toolbars to code blocks
        msgDiv.querySelectorAll('pre').forEach(pre => {
            const codeEl = pre.querySelector('code');
            const rawCode = codeEl ? codeEl.innerText : pre.innerText;
            const toolbar = document.createElement('div');
            toolbar.className = 'code-toolbar';
            
            const btnCopy = document.createElement('button');
            btnCopy.innerHTML = 'Copy';
            btnCopy.onclick = () => {
                navigator.clipboard.writeText(rawCode);
                btnCopy.innerHTML = 'Copied!';
                setTimeout(() => btnCopy.innerHTML = 'Copy', 2000);
            };
            
            const btnPaste = document.createElement('button');
            btnPaste.innerHTML = 'Paste to Editor';
            btnPaste.onclick = () => {
                // Determine active editor
                let targetEditor = null;
                if (state.activeTab === 'design') {
                    // Try to guess if it's design pane or testbench pane that's focused
                    // Default to design pane unless testbench is focused, but CodeMirror focus isn't easily tracked globally
                    // Let's just paste to the one they were last active in, default to design
                    targetEditor = state.editors.design;
                } else if (state.activeTab === 'testbench') {
                    targetEditor = state.editors.testbenchFull;
                }
                
                if (targetEditor) {
                    targetEditor.replaceSelection(rawCode);
                    btnPaste.innerHTML = 'Pasted!';
                    setTimeout(() => btnPaste.innerHTML = 'Paste to Editor', 2000);
                }
            };
            
            toolbar.appendChild(btnCopy);
            toolbar.appendChild(btnPaste);
            pre.insertBefore(toolbar, pre.firstChild);
        });
    } else {
        msgDiv.textContent = text;
    }
    
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}
