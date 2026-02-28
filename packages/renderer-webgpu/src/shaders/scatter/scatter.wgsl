struct Uniforms {
  canvasSize   : vec2f,   // offset 0  - device px
  plotOrigin   : vec2f,   // offset 8  - device px
  plotSize     : vec2f,   // offset 16 - device px
  _pad0        : vec2f,   // offset 24 - padding for vec3 alignment
  zoom         : vec3f,   // offset 32 - k, tx, ty (device px) - ALIGNED!
  pointSizePx  : f32,     // offset 44 - device px
  rgba         : vec4f,   // offset 48
  pointCount   : u32,     // offset 64
  lodStride    : u32,     // offset 68
  lodOffset    : u32,     // offset 72
  _pad1        : u32      // offset 76
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> P : array<vec2f>;

struct VSIn {
  @location(0) corner : vec2f, // unit quad [-0.5..0.5]
  @builtin(instance_index) inst : u32,
};

struct VSOut {
  @builtin(position) pos : vec4f,
};

fn px_to_clip(p: vec2f) -> vec2f {
  let x = (p.x / U.canvasSize.x) * 2.0 - 1.0;
  let y = 1.0 - (p.y / U.canvasSize.y) * 2.0;
  return vec2f(x, y);
}

@vertex
fn vs_main(input: VSIn) -> VSOut {
  let pointIdx = input.inst * U.lodStride + U.lodOffset;
  let p = P[pointIdx];
  var ptPx = U.plotOrigin + (p * U.plotSize) * U.zoom.x + vec2f(U.zoom.y, U.zoom.z);
  let offsetPx = input.corner * U.pointSizePx;
  let finalPx = ptPx + offsetPx;

  let clip = px_to_clip(finalPx);

  var out: VSOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return U.rgba;
}
