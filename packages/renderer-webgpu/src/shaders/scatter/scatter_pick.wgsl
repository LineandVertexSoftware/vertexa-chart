struct PickUniforms {
  canvasSize   : vec2f,   // offset 0
  plotOrigin   : vec2f,   // offset 8
  plotSize     : vec2f,   // offset 16
  _pad0        : vec2f,   // offset 24 - padding for vec3 alignment
  zoom         : vec3f,   // offset 32 - k, tx, ty (device px) - ALIGNED!
  pointSizePx  : f32,     // offset 44
  baseId       : u32,     // offset 48
  pointCount   : u32,     // offset 52
  lodStride    : u32,     // offset 56
  lodOffset    : u32      // offset 60
};

@group(0) @binding(0) var<uniform> U : PickUniforms;
@group(0) @binding(1) var<storage, read> P : array<vec2f>;

struct VSIn {
  @location(0) corner : vec2f,
  @builtin(instance_index) inst : u32,
};

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) @interpolate(flat) gid : u32,
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
  let clip = px_to_clip(ptPx + offsetPx);

  var out: VSOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.gid = U.baseId + pointIdx + 1u;//0 reserved as none
  return out;
}

fn u32_to_rgba8(x: u32) -> vec4f {
  let r = f32((x >>  0u) & 255u) / 255.0;
  let g = f32((x >>  8u) & 255u) / 255.0;
  let b = f32((x >> 16u) & 255u) / 255.0;
  let a = f32((x >> 24u) & 255u) / 255.0;
  return vec4f(r, g, b, a);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return u32_to_rgba8(in.gid);
}
