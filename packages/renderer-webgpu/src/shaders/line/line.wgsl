struct Uniforms {
  canvasSize   : vec2f,   // offset 0
  plotOrigin   : vec2f,   // offset 8
  plotSize     : vec2f,   // offset 16
  _pad0        : vec2f,   // offset 24 - padding for vec3 alignment
  zoom         : vec3f,   // offset 32 - ALIGNED!
  lineWidthPx  : f32,     // offset 44
  rgba         : vec4f,   // offset 48
  dashPattern  : vec4f,   // offset 64
  dashCount    : f32      // offset 80 (struct size rounds to 96)
};

@group(0) @binding(0) var<uniform> U : Uniforms;

struct VSIn {
  @location(0) local : vec2f, // [0..1] across segment, [-1..1] across thickness
  @location(1) p0    : vec2f,
  @location(2) p1    : vec2f
};

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) segDistPx : f32
};

fn px_to_clip(p: vec2f) -> vec2f {
  let x = (p.x / U.canvasSize.x) * 2.0 - 1.0;
  let y = 1.0 - (p.y / U.canvasSize.y) * 2.0;
  return vec2f(x, y);
}

@vertex
fn vs_main(input: VSIn) -> VSOut {
  let p0Px = U.plotOrigin + (input.p0 * U.plotSize) * U.zoom.x + vec2f(U.zoom.y, U.zoom.z);
  let p1Px = U.plotOrigin + (input.p1 * U.plotSize) * U.zoom.x + vec2f(U.zoom.y, U.zoom.z);

  let seg = p1Px - p0Px;
  let segLen = max(length(seg), 1e-5);
  let dir = seg / segLen;
  let normal = vec2f(-dir.y, dir.x);
  let halfW = max(0.5, U.lineWidthPx * 0.5);

  let t = clamp(input.local.x, 0.0, 1.0);
  let side = input.local.y;
  let base = mix(p0Px, p1Px, t);
  let cap = (t * 2.0 - 1.0) * halfW;
  let ptPx = base + dir * cap + normal * side * halfW;
  let clip = px_to_clip(ptPx);

  var out: VSOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.segDistPx = t * segLen;
  return out;
}

fn is_dash_on(distPx: f32) -> bool {
  if (U.dashCount < 0.5) {
    return true;
  }

  var cycle = U.dashPattern.x + U.dashPattern.y;
  if (U.dashCount > 2.5) {
    cycle = cycle + U.dashPattern.z + U.dashPattern.w;
  }
  cycle = max(cycle, 1e-4);

  var d = distPx - floor(distPx / cycle) * cycle;
  if (d < U.dashPattern.x) {
    return true;
  }
  d = d - U.dashPattern.x;
  if (d < U.dashPattern.y) {
    return false;
  }

  if (U.dashCount < 2.5) {
    return true;
  }

  d = d - U.dashPattern.y;
  if (d < U.dashPattern.z) {
    return true;
  }
  d = d - U.dashPattern.z;
  if (d < U.dashPattern.w) {
    return false;
  }
  return true;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
  let on = select(0.0, 1.0, is_dash_on(input.segDistPx));
  return vec4f(U.rgba.rgb, U.rgba.a * on);
}
