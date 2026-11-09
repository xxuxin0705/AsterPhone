// 液态玻璃（照作者给的 whereyanlands《液态玻璃》技术指南）：CSS 只管形状，玻璃感由 WebGL 算——
// 1. 背景源：把宿主页面的背景（图 cover 铺满 + 上面那层渐变）画到一张全屏画布上，所有玻璃共用这一张；
// 2. 每块玻璃按自己在屏幕上的位置，从背景源里切出身后那一块；
// 3. shader：圆角遮罩、从中心到边缘连续的折射（越靠边越往里扭；三种颜色一起偏，不分开，分开边上会出彩虹，作者不要）、低频双轴扰动、左上强右下弱的边缘高光；
// 4. 尺寸、位置变了再画一次（背景是静的，不用一直刷）。WebGL 用不了就退回 CSS 毛玻璃（.is-css）。
// 参数照指南的基准：refract 26、tint 0、blur 0、edge 25、shine 13、wobble 15。
const VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p * .5 + .5; v.y = 1. - v.y; gl_Position = vec4(p, 0., 1.); }';
const FS = `precision mediump float;
uniform sampler2D T; uniform vec2 S; uniform vec4 R; uniform float rad; varying vec2 v;
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
vec3 at(vec2 px) { return texture2D(T, (R.xy + px) / S).rgb; }
void main() {
  vec2 px = v * R.zw, c = px - R.zw * .5;
  float d = box(c, R.zw * .5, rad);
  if (d > 0.) discard;
  float e = clamp(-d / 25., 0., 1.), k = (1. - e) * (1. - e);
  vec2 off = -normalize(c + 1e-4) * k * 26. + vec2(sin(px.y * .05), cos(px.x * .04)) * 1.5 * (1. - .6 * e);
  vec3 col = at(px + off);
  col = col * 1.06 + .13 * k * .35;
  float ang = atan(c.y, c.x), hair = exp(-pow((d + .55) / .62, 2.));
  float glint = hair * (exp(-pow((ang + 2.38) / .6, 2.)) * .66 + exp(-pow((ang - .76) / .62, 2.)) * .48);
  gl_FragColor = vec4(mix(col, vec3(1.), clamp(glint, 0., .76)), 1.);
}`;

/** 背景源：host 的背景图按 background-size: cover、background-position 铺好，再盖上 shade（[顶上的颜色, 底下的颜色]） */
function source(host, img, shade) {
  const W = host.clientWidth, H = host.clientHeight, c = document.createElement('canvas'), x = c.getContext('2d');
  c.width = W; c.height = H;
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  const [px, py] = getComputedStyle(host).backgroundPosition.split(',').pop().trim().split(' ').map(v => parseFloat(v) / 100);
  x.drawImage(img, (W - dw) * (px || .5), (H - dh) * (py ?? .5), dw, dh);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, shade[0]); g.addColorStop(1, shade[1]); x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
}

/** el 变成一块玻璃（里面的字照常放）；host 是背景所在的页面，src 是它的背景图。返回 { refresh, dispose } */
export function glass(el, host, src, shade) {
  const cv = document.createElement('canvas'), gl = cv.getContext('webgl', { premultipliedAlpha: false });
  if (!gl) { el.classList.add('is-css'); return { refresh() {}, dispose() {} }; }
  cv.className = 'as-glass-cv'; el.prepend(cv);
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const img = new Image(); let size = '', ready = false;
  function refresh() {
    if (!ready || !el.isConnected) return;
    const hr = host.getBoundingClientRect(), r = el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    if (size !== hr.width + 'x' + hr.height) { size = hr.width + 'x' + hr.height; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source(host, img, shade)); }
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(U('S'), hr.width, hr.height); gl.uniform4f(U('R'), r.left - hr.left, r.top - hr.top, r.width, r.height);
    gl.uniform1f(U('rad'), parseFloat(getComputedStyle(el).borderTopRightRadius) || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  img.onload = () => { ready = true; refresh(); };
  img.src = src;
  const ro = new ResizeObserver(refresh); ro.observe(el); ro.observe(host);
  return { refresh, dispose() { ro.disconnect(); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}
