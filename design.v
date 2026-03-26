module counter_4bit (
  input  wire       clk,
  input  wire       rst_n,
  input  wire       enable,
  output reg  [3:0] count,
  output wire       overflow
);
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= 4'b0000;
    end else if (enable) begin
      count <= count + 1'b1;
    end
  end
  assign overflow = (count == 4'b1111);
endmodule
