type SharedDeviceState = {
  gpu: Navigator["gpu"];
  device: GPUDevice;
  format: GPUTextureFormat;
  refCount: number;
};

let sharedDeviceState: SharedDeviceState | null = null;
let sharedDevicePromise: Promise<SharedDeviceState> | null = null;
let sharedDeviceGpu: Navigator["gpu"] | null = null;

function hasAdapterFeature(
  adapter: GPUAdapter | { features?: { has?: (feature: string) => boolean } },
  feature: string
): boolean {
  return Boolean(adapter.features && typeof adapter.features.has === "function" && adapter.features.has(feature));
}

async function getSharedDevice(gpu: Navigator["gpu"]): Promise<SharedDeviceState> {
  if (sharedDeviceState && sharedDeviceState.gpu === gpu) {
    return sharedDeviceState;
  }

  if (sharedDevicePromise && sharedDeviceGpu === gpu) {
    return sharedDevicePromise;
  }

  sharedDeviceGpu = gpu;
  sharedDevicePromise = (async () => {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("Failed to get GPU adapter.");

    const requiredFeatures = hasAdapterFeature(adapter, "timestamp-query")
      ? (["timestamp-query"] as GPUFeatureName[])
      : undefined;
    const device = await adapter.requestDevice(requiredFeatures ? { requiredFeatures } : undefined);
    const state: SharedDeviceState = {
      gpu,
      device,
      format: gpu.getPreferredCanvasFormat(),
      refCount: 0
    };

    const lost = (device as GPUDevice & { lost?: Promise<unknown> }).lost;
    if (lost && typeof lost.then === "function") {
      void lost.finally(() => {
        if (sharedDeviceState?.device === device) {
          sharedDeviceState = null;
          sharedDevicePromise = null;
          sharedDeviceGpu = null;
        }
      });
    }

    sharedDeviceState = state;
    return state;
  })().catch((error) => {
    sharedDevicePromise = null;
    sharedDeviceState = null;
    sharedDeviceGpu = null;
    throw error;
  });

  return sharedDevicePromise;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<{
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  release: () => void;
}> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU not supported in this browser. Try Chrome/Edge with WebGPU enabled.");
  }

  const state = await getSharedDevice(navigator.gpu);

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to get WebGPU context.");
  }

  state.refCount += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (sharedDeviceState?.device === state.device && sharedDeviceState.refCount > 0) {
      sharedDeviceState.refCount -= 1;
    }
  };

  return { device: state.device, context, format: state.format, release };
}
