export async function initWebGPU(canvas: HTMLCanvasElement): Promise<{
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU not supported in this browser. Try Chrome/Edge with WebGPU enabled.");
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("Failed to get GPU adapter.");

  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("Failed to get WebGPU context.");

  const format = navigator.gpu.getPreferredCanvasFormat();
  return { device, context, format };
}
