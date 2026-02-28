// Optimized hover shader with single-pass ring rendering
struct Uniforms {
  canvasSize   : vec2f,   // offset 0
  plotOrigin   : vec2f,   // offset 8
  plotSize     : vec2f,   // offset 16
  _pad0        : vec2f,   // offset 24
  zoom         : vec3f,   // offset 32
  pointSizePx  : f32,     // offset 44
  rgba         : vec4f,   // offset 48 - inner color
  outlineRgba  : vec4f    // offset 64 - outline color
};

@group(0) @binding(0) var<uniform> U : Uniforms;

struct VSIn {
  @location(0) corner : vec2f, // unit quad [-0.5..0.5]
  @location(1) p      : vec2f, // point in [0,1]
};

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

fn px_to_clip(p: vec2f) -> vec2f {
  let x = (p.x / U.canvasSize.x) * 2.0 - 1.0;
  let y = 1.0 - (p.y / U.canvasSize.y) * 2.0;
  return vec2f(x, y);
}

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var ptPx = U.plotOrigin + (input.p * U.plotSize) * U.zoom.x + vec2f(U.zoom.y, U.zoom.z);
  let offsetPx = input.corner * U.pointSizePx;
  let finalPx = ptPx + offsetPx;

  let clip = px_to_clip(finalPx);

  var out: VSOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.uv = input.corner; // [-0.5, 0.5]
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let dist = length(in.uv); // distance from center
  
  // Discard outside circle
  if (dist > 0.5) {
    discard;
  }
  
  // Ring effect: outline on outer 30%, inner color on center
  let outlineThreshold = 0.35;
  
  if (dist > outlineThreshold) {
    return U.outlineRgba;
  } else {
    return U.rgba;
  }
}
