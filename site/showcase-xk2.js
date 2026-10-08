/* 小克版实验引擎 · 暗场显微
 * WebGL2 全屏光场放在页面内容后面；HDR 渲染 + 逐级泛光 + ACES 色调映射。
 * 对外接口与旧引擎一致（window.ScheduleShowcaseEngine），index.html 不需要知道内部换了什么。
 * 规则：光场永远在内容后面，不挡操作，不需要“收束”按钮；课程卡只做 CSS 反应。
 */
(() => {
'use strict';
const host = () => window.ScheduleShowcaseHost;
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => Boolean(host()?.reduceMotion?.()) || motionQuery.matches;
const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const clock = () => performance.now() / 1000;

/* ───────────────────────── 着色器 ───────────────────────── */
const VERT = `#version 300 es
out vec2 vUv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uTime, uT, uEnc;
uniform vec4 uTap[4];
uniform vec4 uEdge[12]; uniform vec2 uEdgeT[12]; uniform int uEdgeN;
uniform vec4 uCut; uniform float uCutAge;
uniform vec4 uPaw; uniform float uPawOn;
uniform vec4 uBand;
uniform vec2 uCenter; uniform float uScale, uReach, uY0;
uniform vec4 uP[6];
uniform vec2 uShake; uniform float uBlack;             // 镜头震动 / 黑帧                                  // 各场景自己的逐帧参数（由 JS 时间线算好）
#define TAU 6.2831853
#define PI 3.1415927
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5, s=0.; mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<4;i++){ s+=a*vnoise(p); p=m*p; a*=.5; } return s; }
vec3 film(float x){ vec3 c=.5+.5*cos(TAU*(x+vec3(.55,.72,.92))); return c*c*vec3(.9,.95,1.2); }
float easeOut(float t){ t=clamp(t,0.,1.); return 1.-pow(1.-t,3.); }
float caustic(vec2 uv, float t){
  vec2 p = uv*TAU - 250.; vec2 i = p; float c = 1.; const float inten = .005;
  for(int n=0;n<4;n++){
    float tt = t*(1.-(3.5/float(n+1)));
    i = p + vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c += 1./length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c /= 4.; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.);
}
vec3 ambient(vec2 p, vec2 warp){
  float t = uTime;
  float n = fbm(p*1.3 + vec2(t*.015, -t*.011));
  vec3 col = mix(vec3(.0035,.0028,.011), vec3(.016,.009,.040), n);
  float cz = caustic((p+warp)*.85, t*.16);
  float mask = smoothstep(.25,.85, fbm(p*.75 - t*.02));
  col += vec3(.05,.045,.19) * cz * (.25 + .75*mask);
  return col;
}
vec3 ripples(vec2 p, inout vec2 warp){
  vec3 c = vec3(0);
  for(int i=0;i<4;i++){
    vec4 tp = uTap[i]; if(tp.w < .5) continue;
    float age = tp.z, r = age*.62;
    vec2 d = p - tp.xy; float L = length(d);
    float fade = exp(-age*1.5) * smoothstep(0.,.04,age) * tp.w;
    float x = L - r;
    warp += (d/(L+1e-4)) * (-x*exp(-x*x*260.)) * fade * .9;
    vec3 ring = vec3(exp(-pow(x+.007,2.)*1600.), exp(-x*x*1600.), exp(-pow(x-.007,2.)*1600.));
    c += ring * fade * vec3(.9,1.,1.8) * 1.6;
    c += film(x*9.+age) * exp(-max(-x,0.)*14.) * step(x,0.) * fade * .22;
    c += vec3(.6,.7,1.3) * exp(-L*L*260.) * exp(-age*9.) * 5. * tp.w;
  }
  return c;
}
vec3 band(vec2 p, inout vec2 warp){
  if(uBand.z < .002) return vec3(0);
  float dx = p.x-uBand.x, w = uBand.y, g = exp(-dx*dx/(w*w));
  warp.x += dx*g*.35*uBand.z;
  vec3 c = vec3(.30,.40,1.15)*g*.7 + film(dx*7.+p.y*.9+uTime*.2)*exp(-dx*dx/(w*w*.06))*.9;
  return c*uBand.z*(.55+.45*smoothstep(.65,0.,abs(p.y)));
}
vec3 scalpel(vec2 p, inout vec2 warp){
  if(uCutAge < 0.) return vec3(0);
  float age = uCutAge; vec2 a=uCut.xy, ba=uCut.zw-uCut.xy; float len=max(length(ba),1e-4);
  vec2 dir=ba/len, nrm=vec2(-dir.y,dir.x), pa=p-a;
  float al=dot(pa,dir), side=dot(pa,nrm);
  float draw=clamp(age/.14,0.,1.);
  float taper=sin(clamp(al/len,0.,1.)*PI);
  float dAl = al<0. ? -al : (al>len*draw ? al-len*draw : 0.);
  float d=length(vec2(side,dAl)), inCut=step(dAl,0.);
  float open=smoothstep(0.,.18,age)*(1.-smoothstep(.45,1.4,age));
  float w=.0022+.009*open*taper;
  warp += nrm*sign(side)*exp(-abs(side)*55.)*inCut*.03*open*taper;
  float live=1.-smoothstep(.9,1.5,age);
  vec3 c = vec3(1.,.93,.85)*exp(-d*d/(w*w))*(2.+5.*open)*live;
  c += film(side*30.+age)*exp(-d*60.)*.5*(open+.2)*live;
  c += vec3(.8,.4,.95)*exp(-d*d*80000.)*inCut*smoothstep(1.,1.4,age)*(1.-smoothstep(1.5,2.6,age))*.9;
  vec2 tip=a+ba*draw; float dt=length(p-tip);
  c += vec3(1.,.9,.8)*exp(-dt*dt*4000.)*(1.-smoothstep(.12,.3,age))*8.;
  return c;
}
float sdEll(vec2 p, vec2 r){ return (length(p/r)-1.)*min(r.x,r.y); }
vec3 paws(vec2 p){
  if(uPawOn < .5) return vec3(0);
  float age=uPaw.w; vec2 fw=vec2(cos(uPaw.z),sin(uPaw.z)), sd=vec2(fw.y,-fw.x);
  vec3 c=vec3(0);
  for(int k=0;k<7;k++){
    float fk=float(k), a2=age-fk*.24; if(a2<0.) break;
    vec2 q=p-(uPaw.xy+fw*fk*.075+sd*(mod(fk,2.)<1.?.026:-.026));
    q=vec2(dot(q,sd),dot(q,fw));
    q/=(1.+.35*exp(-a2*9.))*1.15;
    float s=sdEll(q,vec2(.016,.013));
    s=min(s,length(q-vec2(-.018,.017))-.0062);
    s=min(s,length(q-vec2(-.0065,.027))-.0064);
    s=min(s,length(q-vec2(.0065,.027))-.0064);
    s=min(s,length(q-vec2(.018,.017))-.0062);
    float life=exp(-max(a2-.4,0.)*1.1);
    c += (vec3(1.,.5,.78)*smoothstep(.0015,-.0015,s)*1.3 + vec3(1.,.4,.8)*exp(-max(s,0.)*140.)*.5)*life;
    c += vec3(1.,.8,.9)*exp(-a2*10.)*exp(-dot(q,q)*1500.)*3.;
  }
  return c;
}
// 曲速星线：每个角度扇区一颗星，按透视从中心往外冲；len 越大拖尾越长
vec3 streaks(vec2 q, float travel, float len){
  float r=length(q), a=atan(q.y,q.x)/TAU+.5; vec3 c=vec3(0);
  for(int l=0;l<3;l++){
    float fl=float(l), N=64.+44.*fl, sec=floor(a*N);
    float h=h21(vec2(sec,fl*13.1+1.)), h2=h21(vec2(sec,fl*7.7+3.));
    float ad=abs(fract(a*N)-.5)/N*TAU*r;
    float z=max(fract(h2 - travel*(.55+.9*h)), .015);
    float rh=.07/z, rt=.07/(z+len);
    float body=smoothstep(rt, rh, r)*step(r, rh);
    float w=.0009+.0032*(1.-z);
    c += mix(vec3(.45,.5,1.4), vec3(1.2,1.15,1.3), h) * body*exp(-ad*ad/(w*w))*(1.-z)*(1.-z)*1.7;
  }
  return c;
}
vec4 scene(vec2 p, inout vec2 warp);
void main(){
  vec2 p = (gl_FragCoord.xy - .5*uRes) / uRes.y + uShake;
  vec2 warp = vec2(0);
  vec3 rip = ripples(p, warp);
  vec3 cut = scalpel(p, warp);
  vec3 bd = band(p, warp);
  vec4 s = scene(p, warp);
  vec3 col = ambient(p, warp)*s.a + s.rgb + rip + cut + bd + paws(p);
  fragColor = vec4(min(col, vec3(60.))*uEnc*(1.-uBlack), 1.);
}
`;

const SCENES = {
idle: `vec4 scene(vec2 p, inout vec2 warp){ return vec4(0,0,0,1); }`,

/* 显微启明：一点光聚焦 → 光圈扩开 → 焦散被点亮后退回暗场 */
ignite: `vec4 scene(vec2 p, inout vec2 warp){
  float t = uT; vec2 q = p - uCenter; float L = length(q);
  float env = 1. - smoothstep(.62, 1., t);
  float core = smoothstep(0.,.10,t) * (1. - smoothstep(.14,.36,t));
  vec3 c = vec3(1.,.86,.72) * exp(-L*L*700.) * core * 16.;
  c += vec3(.45,.4,1.) * exp(-L*14.) * core * .5;
  c += vec3(.35,.6,1.) * exp(-abs(q.y)*420.) * exp(-abs(q.x)*4.5) * core * 2.4;
  float r = uReach * easeOut((t-.12)/.55);
  float x = L - r, on = step(.12,t);
  vec3 ring = vec3(exp(-pow(x+.011,2.)*2600.), exp(-x*x*2600.), exp(-pow(x-.011,2.)*2600.));
  c += ring * vec3(1.,1.05,1.5) * on * env * 2.4;
  c += film(x*5.+t*.8) * exp(max(x,-1.)*12.) * step(x,0.) * on * env * .18;
  float wake = exp(min(x,0.)*5.) * smoothstep(.01,-.04,x) * on;
  float cz = caustic((p+warp)*.85, uTime*.16);
  float reveal = wake * (1. - smoothstep(.5,.95,t));
  c += (vec3(.2,.25,.9) + film(cz*.4 + L*1.4)) * pow(cz,1.6) * reveal * .9;
  float iris = mix(.15, 1., smoothstep(.0,.08,-x) * on);
  iris = mix(iris, 1., smoothstep(.55,.9,t));
  return vec4(c, iris);
}`,

/* 收束：光圈收回到“退出实验”按钮，最后一闪 */
collapse: `vec4 scene(vec2 p, inout vec2 warp){
  float t = uT; vec2 q = p - uCenter; float L = length(q);
  float r = uReach * (1. - pow(clamp(t/.8,0.,1.), 2.2));
  float x = L - r, live = 1. - smoothstep(.78,.86,t);
  vec3 ring = vec3(exp(-pow(x+.011,2.)*2600.), exp(-x*x*2600.), exp(-pow(x-.011,2.)*2600.));
  vec3 c = ring * vec3(1.,1.05,1.5) * 2.2 * live;
  c += film(x*5.+t) * exp(-max(x,0.)*12.) * step(0.,x) * .15 * live;
  float inside = smoothstep(.02,-.02,x);
  float fl = exp(-pow((t-.84)*18.,2.));
  c += vec3(1.,.86,.72) * exp(-L*L*900.) * fl * 14.;
  c += vec3(.35,.6,1.) * exp(-abs(q.y)*420.) * exp(-abs(q.x)*4.5) * fl * 2.;
  return vec4(c, mix(.12,1.,inside) * live * (1.-smoothstep(.86,1.,t)));
}`,

/* 细胞分裂：一个 → 两个 → 四个，膜上是薄膜干涉色，最后碎成光点 */
mitosis: `float smin(float a, float b, float k){ float h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
vec4 scene(vec2 p, inout vec2 warp){
  float t = uT;
  float env = smoothstep(0.,.09,t) * (1. - smoothstep(.84,1.,t));
  float s1 = smoothstep(.14,.42,t), s2 = smoothstep(.44,.70,t);
  float a = .35 + t*.9; mat2 R = mat2(cos(a),-sin(a),sin(a),cos(a));
  float grow = 1. + smoothstep(.72,1.,t)*.9;
  vec2 q = R * (p - uCenter + warp*.5) / (grow*uScale);
  float r0 = .17, r1 = r0*mix(1.,.78,s1), r2 = r1*mix(1.,.80,s2);
  float d1 = .165*s1, d2 = .118*s2;
  vec2 C[4]; C[0]=vec2(-d1,-d2); C[1]=vec2(-d1,d2); C[2]=vec2(d1,-d2); C[3]=vec2(d1,d2);
  float ang = atan(q.y,q.x);
  float f = 1e3;
  for(int i=0;i<4;i++){
    vec2 dq = q - C[i];
    float wob = .010*sin(atan(dq.y,dq.x)*5. + uTime*1.7 + float(i)*1.3) + .018*(vnoise(dq*9.+uTime*.6+float(i))-.5);
    f = smin(f, length(dq) - r2 - wob, .075);
  }
  f *= uScale;
  float inside = smoothstep(.006,-.02,f);
  float shatter = smoothstep(.72,.95,t);
  float dots = smoothstep(.62,.8,vnoise(q*48.+uTime*.3)) * 2.2;
  float mem = exp(-abs(f)*(210.-120.*shatter)) * mix(1., dots, shatter);
  inside *= 1. - shatter;
  vec3 memc = film(f*6. + ang*.16 + uTime*.12 + fbm(q*3.)*.8);
  vec3 c = memc * mem * 2.2;
  c += vec3(.55,.45,1.) * exp(-abs(f)*40.) * .09;
  c += vec3(.22,.12,.62) * exp(f*22.) * inside * .38;
  float cyto = fbm(q*10. + vec2(uTime*.25, -uTime*.2));
  c += vec3(.025,.016,.07) * (.4 + 1.4*cyto) * inside;
  float nk = 1. - .85*(smoothstep(.10,.18,t)*(1.-smoothstep(.36,.46,t))) - .85*(smoothstep(.42,.48,t)*(1.-smoothstep(.62,.72,t)));
  for(int i=0;i<4;i++){ vec2 dq=q-C[i]; c += vec3(1.,.72,.55) * exp(-dot(dq,dq)*900./(r2*r2*18.)) * nk * (1.-shatter) * .9; }
  float p1 = s1*(1.-s1)*4.;
  vec2 pole = vec2(d1+r1*.62,0);
  c += vec3(.7,.85,1.) * (exp(-dot(q-pole,q-pole)*5000.) + exp(-dot(q+pole,q+pole)*5000.)) * p1 * 12.;
  float k1 = exp(-pow((t-.395)*28.,2.)), k2 = exp(-pow((t-.655)*28.,2.));
  c += vec3(.8,.9,1.5) * exp(-dot(q,q)*420.) * k1 * 9.;
  c += vec3(.8,.9,1.5) * (exp(-dot(q-vec2(d1,0),q-vec2(d1,0))*600.) + exp(-dot(q+vec2(d1,0),q+vec2(d1,0))*600.)) * k2 * 8.;
  return vec4(c*env, 1. - .45*env);
}`,

/* 神经脉冲：电信号沿树突依次点亮每门课 */
neural: `vec2 cellEdge(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(h21(i+g),h21(i+g+17.3));
    o = .5+.4*sin(uTime*.4 + TAU*o); float d=length(g+o-f); if(d<d1){d2=d1;d1=d;} else if(d<d2) d2=d; }
  return vec2(d1, d2-d1); }
vec4 scene(vec2 p, inout vec2 warp){
  float t = uT;
  float env = smoothstep(0.,.06,t) * (1. - smoothstep(.86,1.,t));
  vec3 c = vec3(0);
  vec2 ce = cellEdge((p+warp)*5.5 + fbm(p*2.)*.8);
  c += vec3(.12,.16,.6) * exp(-ce.y*70.) * .06 * env;
  for(int i=0;i<12;i++){
    if(i>=uEdgeN) break;
    vec4 e = uEdge[i]; vec2 a=e.xy, b=e.zw;
    vec2 ba=b-a; float len=max(length(ba),1e-3); vec2 dir=ba/len, nrm=vec2(-dir.y,dir.x);
    vec2 pa=p-a; float along=dot(pa,dir); float h=clamp(along/len,0.,1.);
    float fi=float(i);
    float bend=(h21(vec2(fi,3.1))-.5)*.30*len;
    float sw=sin(h*PI);
    float target=(bend + (vnoise(vec2(h*len*12.,fi*7.))-.5)*.05 + (vnoise(vec2(h*len*38.,fi*3.))-.5)*.012)*sw;
    float side=dot(pa,nrm);
    float dAl = along<0. ? -along : (along>len ? along-len : 0.);
    float d = length(vec2(side-target, dAl));
    vec2 et = uEdgeT[i]; float u = (t-et.x)/et.y;
    float vis = smoothstep(-.6,0.,u) * (1.-smoothstep(1.4,2.6,u));
    c += vec3(.3,.36,1.2) * (exp(-d*d*30000.)*.8 + exp(-d*90.)*.04) * vis;
    if(u>-.05 && u<1.25){
      float k=(h-u)*len;
      float head=exp(-k*k*2600.);
      float tail=k<0. ? exp(k*9.)*step(-u*len,k) : 0.;
      float core=exp(-d*d*26000.);
      c += vec3(.55,.95,1.2) * core * (head*14. + tail*2.2);
      c += vec3(.3,.45,1.4) * exp(-d*d*900.) * head * 1.6;
    }
    float age = (u-1.)*et.y;
    if(age>0. && age<2.){
      vec2 qb=p-b; float rb=length(qb);
      float fl=exp(-age*4.5);
      c += vec3(.7,.95,1.3) * exp(-rb*rb*1100.) * fl * 3.2;
      c += vec3(.4,.8,1.3) * (exp(-abs(qb.y)*380.)*exp(-abs(qb.x)*38.) + exp(-abs(qb.x)*380.)*exp(-abs(qb.y)*38.)) * fl * 1.4;
      float x=rb-age*.26; c += film(x*14.+age) * exp(-x*x*12000.) * exp(-age*5.) * .6;
    }
  }
  return vec4(c*env, 1. - .35*env);
}`,

/* 心电扫描：一条心电图从左扫到右，每个 QRS 波让暗场跳一下 */
ecg: `float gs(float x,float c,float w){ return exp(-pow((x-c)/w,2.)); }
float ecg(float ph){ float f=fract(ph);
  return .10*gs(f,.16,.035) - .08*gs(f,.30,.009) + gs(f,.33,.011) - .25*gs(f,.36,.010) + .22*gs(f,.56,.05); }
vec4 scene(vec2 p, inout vec2 warp){
  float t=uT, hw=.5*uRes.x/uRes.y, L=length(p);
  float env=smoothstep(0.,.05,t)*(1.-smoothstep(.88,1.,t));
  float xh=-hw+clamp((t-.05)/.8,0.,1.)*2.*hw;
  float A=.10, Y0=uY0, dx=.0016, d=1e3;
  vec2 prev=vec2(p.x-3.*dx, Y0+A*ecg((p.x-3.*dx+hw)/hw));
  for(int k=-2;k<=3;k++){
    float x=p.x+float(k)*dx; vec2 cur=vec2(x, Y0+A*ecg((x+hw)/hw));
    vec2 pa=p-prev, ba=cur-prev; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);
    d=min(d, length(pa-ba*h)); prev=cur;
  }
  float behind=xh-p.x;
  float vis=smoothstep(-.004,.0,behind)*exp(-max(behind,0.)*3.5);
  vec3 c=vec3(.35,1.,.75)*(exp(-d*d*60000.)*3. + exp(-d*d*2500.)*.35)*vis;
  float yh=Y0+A*ecg((xh+hw)/hw); vec2 dh=p-vec2(xh,yh);
  c += vec3(.7,1.,.9)*exp(-dot(dh,dh)*3000.)*6.*step(t,.86);
  float pulse=0.;
  for(int k=0;k<2;k++){
    float tb=.05+.8*((float(k)+.33)/2.), a=t-tb;
    pulse += exp(-pow(a*22.,2.));
    if(a>0.){ vec2 bp=vec2(-hw+((float(k)+.33)/2.)*2.*hw, Y0+A); float x=length(p-bp)-a*.9; c += film(x*8.+a)*exp(-x*x*5000.)*exp(-a*4.)*.5; }
  }
  c += vec3(1.,.22,.42)*exp(-L*4.5)*pulse*.16;
  return vec4(c*env, 1.-.3*env+pulse*.18);
}`
};

SCENES.warp = `vec4 scene(vec2 p, inout vec2 warp){
  vec4 A=uP[0], B=uP[1], R=uP[2], T=uP[3], C=uP[4];
  float light=A.x, rh=A.y, flash=A.z, shock=A.w;
  vec3 c=vec3(0);
  // ① 黑洞：页面被吸进你点的那一点
  vec2 q=p-uCenter; float L=length(q), an=atan(q.y,q.x), holeM=1.;
  if(rh>.0005){
    float lens=smoothstep(rh*.9, rh*5.+.03, L);
    holeM=smoothstep(rh, rh*1.06, L)*mix(.3,1.,lens);
    float swirl=pow(.5+.5*sin(an*3.-log(L+.001)*7.+uTime*7.),6.)*(1.-lens);
    c+=vec3(1.2,.9,2.6)*exp(-pow((L-rh*1.25)/(.005+rh*.08),2.))*3.2;
    c+=film(L*6.+an*.3)*swirl*.7*smoothstep(rh,rh*1.3,L);
  }
  c+=vec3(2.05,1.95,2.3)*light*holeM;
  // 蓄力：光核越来越亮，四周光点往里汇聚
  float charge=T.w;
  if(charge>.001){
    c+=vec3(1.,.86,.75)*exp(-L*L*(900.-650.*charge))*charge*charge*14.;
    c+=vec3(.5,.4,1.25)*exp(-L*6.)*charge*.9;
    c+=streaks(q, C.z, .05+.12*charge)*charge*1.3;
  }
  // ② 奇点爆开：白闪 + 色散冲击波
  c+=vec3(1.,.96,1.12)*flash*7.;
  if(shock>0.){
    float x=L-shock*2.4, f=exp(-shock*2.);
    c+=vec3(exp(-pow(x+.02,2.)*1100.),exp(-x*x*1100.),exp(-pow(x-.02,2.)*1100.))*f*5.5;
    c+=film(x*6.)*exp(-max(-x,0.)*6.)*step(x,0.)*f*.5;
    warp+=(q/(L+1e-4))*(-x*exp(-x*x*160.))*f*1.7;
  }
  // ③ 曲速隧道
  if(B.z>.001){
    vec2 k=p-C.xy; float r=length(k);
    c+=streaks(k, B.x, .03+B.y*.42+C.w)*B.z*(1.+C.w*1.5);
    c+=vec3(.35,.3,1.)*exp(-r*5.)*B.z*(.4+B.y*.9);
    c+=vec3(1.,.95,1.2)*exp(-r*r*450.)*B.z*B.y*3.;
    c+=vec3(.3,.25,.9)*pow(.5+.5*sin(9.6/(r+.03)-B.x*40.),16.)*smoothstep(.02,.3,r)*.25*B.z*B.y;
  }
  // ④ 锁定：一道光沿课表外框绕一圈
  if(T.y>.001 || T.z>.001){
    vec2 k=p-R.xy, b=R.zw; float rad=.03;
    vec2 d=abs(k)-b+rad; float sd=length(max(d,0.))+min(max(d.x,d.y),0.)-rad;
    float ang=atan(k.y/b.y, k.x/b.x)/TAU+.5;
    float behind=fract(T.x-ang);
    float comet=exp(-behind*7.)*step(behind,.98)*T.y;
    float line=exp(-sd*sd*70000.), halo=exp(-abs(sd)*90.);
    c+=(vec3(.6,.9,1.35)*line*3.2 + film(ang*2.+uTime*.3)*halo*.45)*(comet+T.z*.8);
  }
  return vec4(c, B.w*holeM);
}`;

/* 漩涡传送门：按钮处拧开漩涡，把页面卷进去，闪一下，再把新页面转出来 */
SCENES.vortex = `vec4 scene(vec2 p, inout vec2 warp){
  vec4 A=uP[0]; float st=A.x, spin=A.y, flash=A.z, burst=A.w;
  vec2 q=p-uCenter; float L=length(q), an=atan(q.y,q.x);
  float tw=st*5.5*exp(-L*2.3)*sign(spin+1e-4);
  vec2 qr=mat2(cos(tw),-sin(tw),sin(tw),cos(tw))*q;
  warp+=(qr-q);
  float arms=pow(.5+.5*sin(3.*an + 10.*log(L+.015) - spin*3.), 10.);
  vec3 c=film(L*4.+an*.3+spin*.08)*arms*exp(-L*3.)*smoothstep(.01,.06,L)*st*2.6;
  float rc=.04*st;
  c+=vec3(.9,.8,1.6)*exp(-pow((L-rc*1.4)/(.004+.01*st),2.))*st*4.;
  c+=vec3(.35,.3,1.)*exp(-L*6.)*st*.9;
  float core=smoothstep(rc*1.1,rc*.55,L)*st;
  c+=vec3(1.,.95,1.15)*flash*3.4;
  if(burst>0. && burst<1.4) c+=streaks(q, burst*1.5, .3)*exp(-burst*2.6)*2.6;
  return vec4(c*(1.-core), (1.-.55*st)*(1.-core));
}`;


/* 坠入水晶球：吸积漩涡 → 黑洞与引力透镜 → 冲击 → 水晶内部 → 凝晶光环 */
SCENES.crystal = `vec3 crystal(vec2 k, float travel, float dir){
  float r=length(k), a=atan(k.y,k.x)/TAU+.5;
  float z=.22/(r+.035)+travel;
  const float N=9.;
  vec2 uv=vec2(fract(a+uTime*.025*dir)*N, z*1.6);
  vec2 i=floor(uv), f=fract(uv); float d1=8., d2=8.; vec2 id=vec2(0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(x,y), cell=i+g, hc=vec2(mod(cell.x,N),cell.y);
    vec2 o=vec2(h21(hc),h21(hc+17.3))*.8+.1; float d=length(g+o-f);
    if(d<d1){ d2=d1; d1=d; id=hc; } else if(d<d2) d2=d;
  }
  float e=d2-d1, hs=h21(id+3.7);
  vec3 edge=film(hs*.7+z*.05+uTime*.05)*exp(-e*26.)*1.5 + vec3(.9,.95,1.45)*exp(-e*95.)*1.3;
  vec3 face=mix(vec3(.02,.015,.07), vec3(.11,.07,.32), hs)*(.4+.6*pow(1.-clamp(d1,0.,1.),2.))*(.6+.4*sin(z*3.+hs*6.));
  float glint=pow(max(0.,sin(z*2.+hs*40.-uTime*3.)),40.)*exp(-e*18.)*1.6;
  return (edge+face+vec3(.8,.85,1.3)*glint)*smoothstep(.02,.13,r)*(.35+.65*smoothstep(0.,.5,r));
}
vec4 scene(vec2 p, inout vec2 warp){
  vec4 A=uP[0], B=uP[1], C=uP[2], D=uP[3];
  float pull=A.x, spin=A.y, hole=A.z, lens=A.w;
  float travel=B.x, tun=B.y, inflow=B.z, amb=B.w;
  float flash=C.x, burst=C.y, ring=C.z, rv=C.w;
  float core=D.x, dir=D.y;
  vec2 q=p-uCenter; float L=length(q), an=atan(q.y,q.x);
  vec3 c=vec3(0); float mask=1.;
  // ① 吸积漩涡：暗场被拧成旋臂，星光往中心流
  if(pull>.001){
    float tw=pull*6.*exp(-L*2.)*dir;
    vec2 qr=mat2(cos(tw),-sin(tw),sin(tw),cos(tw))*q; warp+=(qr-q)*.8;
    float arms=pow(.5+.5*sin(2.*an+9.*log(L+.02)-spin*2.5), 8.);
    c+=mix(vec3(.30,.26,1.05), vec3(.95,.85,1.45), arms)*arms*exp(-L*3.2)*smoothstep(.02,.1,L)*pull*.75;
    c+=film(L*3.+an*.25+spin*.05)*arms*exp(-L*4.)*pull*.12;
    c+=streaks(q, -inflow, .04+.08*pull)*pull*.45;
    c+=vec3(.4,.32,1.1)*exp(-L*5.)*pull*.4;
  }
  // ② 黑洞：光线被弯折（引力透镜）、光子环、压扁的吸积盘、盘背面被弯到上方的弧
  if(hole>.0005){
    float rs=hole;
    warp+=q/(L*L+1e-4)*rs*rs*1.8*lens;
    c+=(vec3(1.1,.95,1.7)+film(an*.5+uTime*.2)*.4)*exp(-pow((L-rs*1.5)/(.003+rs*.04),2.))*2.6*lens;
    vec2 dq=vec2(q.x, q.y*4.2); float dl=length(dq), da=atan(dq.y,dq.x);
    float disk=exp(-pow((dl-rs*2.6)/(rs*1.1),2.))*smoothstep(rs*1.05, rs*1.5, L);
    float dop=.5+.5*cos(da-.4);
    float flow=.65+.35*sin(da*7.-uTime*6.*dir+dl*30.);
    c+=mix(vec3(.4,.35,1.5), vec3(1.3,1.1,1.4), dop)*disk*(.3+.9*dop)*flow*1.1*lens;
    float arc=exp(-pow((L-rs*1.9)/(rs*.2),2.))*smoothstep(-.1,.7,q.y/(L+1e-4));
    c+=vec3(.9,.8,1.3)*arc*.8*lens;
    float inside=smoothstep(rs*1.02, rs*.94, L);
    c*=1.-inside; mask=(1.-inside)*mix(.3,1.,smoothstep(rs,rs*7.,L));
  }
  // ③ 冲击波
  if(burst>=0.){
    float x=L-burst*2.2, f=exp(-burst*2.2);
    c+=vec3(exp(-pow(x+.02,2.)*900.),exp(-x*x*900.),exp(-pow(x-.02,2.)*900.))*f*3.5;
    warp+=(q/(L+1e-4))*(-x*exp(-x*x*160.))*f*1.5;
    c+=streaks(q, burst*2., .35)*exp(-burst*3.5)*1.4;
  }
  // ④ 水晶内部：棱面往身后退，棱线是薄膜干涉色
  if(tun>.001) c+=crystal(q, travel, dir)*tun;
  c+=vec3(1.,.95,1.2)*exp(-L*L*mix(110.,32.,core))*core*2.;
  // ⑤ 凝晶光环：扫过哪里，哪里的内容就结晶成形
  if(ring>=0.){
    float R=ring*rv, x=L-R, f=exp(-ring*1.9)*smoothstep(0.,.04,ring);
    c+=vec3(exp(-pow(x+.012,2.)*2200.),exp(-x*x*2200.),exp(-pow(x-.012,2.)*2200.))*vec3(.9,1.,1.6)*f*3.2;
    c+=film(x*10.+ring)*exp(-max(-x,0.)*14.)*step(x,0.)*f*.18;
    float sparks=smoothstep(.82,.95,vnoise(vec2(an*24.,L*30.)+ring*3.))*exp(-abs(x)*40.);
    c+=vec3(.9,.95,1.5)*sparks*f*2.5;
    warp+=(q/(L+1e-4))*(-x*exp(-x*x*300.))*f*.8;
  }
  c+=vec3(1.,.97,1.1)*flash*1.2;
  return vec4(c, amb*mask);
}`;

const PRE = `#version 300 es
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform int uPre; uniform float uThr, uKnee;`;
const DOWN = PRE + `
vec3 T(vec2 o){ return texture(uSrc, vUv + o*uTexel).rgb; }
void main(){
  vec3 c = (T(vec2(0))*4. + T(vec2(-1,-1)) + T(vec2(1,-1)) + T(vec2(-1,1)) + T(vec2(1,1))) / 8.;
  if(uPre==1){ float br=max(c.r,max(c.g,c.b)); float s=clamp(br-uThr+uKnee,0.,2.*uKnee); s=s*s/(4.*uKnee+1e-4);
    c *= max(s, br-uThr)/max(br,1e-4); }
  fragColor = vec4(c,1.);
}`;
const UP = PRE + `
vec3 T(vec2 o){ return texture(uSrc, vUv + o*uTexel).rgb; }
void main(){
  vec3 c = T(vec2(0))*4. + (T(vec2(1,0))+T(vec2(-1,0))+T(vec2(0,1))+T(vec2(0,-1)))*2.
         + T(vec2(1,1))+T(vec2(-1,1))+T(vec2(1,-1))+T(vec2(-1,-1));
  fragColor = vec4(c/16.,1.);
}`;
const COMPOSITE = `#version 300 es
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uScene, uBloom; uniform float uBloomK, uExp, uTime, uEnc, uCAk, uInvert;
float h(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){
  vec2 cc = vUv-.5; float r2 = dot(cc,cc), ca = .010*r2*uCAk + .0015*(uCAk-1.);
  vec3 s = vec3(texture(uScene, vUv-cc*ca).r, texture(uScene, vUv).g, texture(uScene, vUv+cc*ca).b);
  vec3 c = (s + texture(uBloom, vUv).rgb*uBloomK) / uEnc * uExp;
  c = aces(c);
  c *= 1. - r2*.85;
  c = pow(c, vec3(1./2.2));
  c = mix(c, 1.-c, uInvert);                 // 冲击帧：一瞬间反色
  c += (h(gl_FragCoord.xy + fract(uTime*7.31)*vec2(97.,53.)) - .5) * .028;
  fragColor = vec4(c,1.);
}`;

/* ───────────────────────── 渲染器 ───────────────────────── */
function createRenderer(canvas){
  const gl = canvas.getContext('webgl2', {antialias:false, alpha:false, depth:false, stencil:false, premultipliedAlpha:false, powerPreference:'high-performance'});
  if (!gl) return null;
  const HDR = !!gl.getExtension('EXT_color_buffer_float');
  const ENC = HDR ? 1 : .125;
  const IFMT = HDR ? gl.RGBA16F : gl.RGBA8, TYPE = HDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const program = frag => {
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i=0;i<n;i++){ const info = gl.getActiveUniform(p,i); u[info.name.replace(/\[0\]$/,'')] = gl.getUniformLocation(p, info.name); }
    return {p, u};
  };
  const scenes = {};
  for (const k of Object.keys(SCENES)) scenes[k] = program(COMMON + SCENES[k]);
  const P = {scenes, down:program(DOWN), up:program(UP), comp:program(COMPOSITE)};
  gl.bindVertexArray(gl.createVertexArray());
  const target = (w, h) => {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, IFMT, w, h, 0, gl.RGBA, TYPE, null);
    for (const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return {tex, fb, w, h};
  };
  const drop = t => { if (t){ gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };
  let sceneT = null, mips = [], cw = 0, ch = 0, sw = 0, sh2 = 0;
  const R = {gl, HDR, ENC, lost:false,
    size(W, H, SW, SH, mipCount){
      if (W===cw && H===ch && SW===sw && SH===sh2 && mips.length) return;
      cw=W; ch=H; sw=SW; sh2=SH; canvas.width=W; canvas.height=H;
      drop(sceneT); mips.forEach(drop); mips=[];
      sceneT = target(SW, SH);
      let w = SW>>1, h = SH>>1;
      for (let i=0;i<mipCount && w>2 && h>2;i++){ mips.push(target(w,h)); w>>=1; h>>=1; }
    },
    draw(kind, U){
      const quad = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
      const prog = P.scenes[kind] || P.scenes.idle, u = prog.u;
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fb); gl.viewport(0,0,sw,sh2);
      gl.useProgram(prog.p);
      gl.uniform2f(u.uRes, sw, sh2); gl.uniform1f(u.uTime, U.time); gl.uniform1f(u.uT, U.t); gl.uniform1f(u.uEnc, ENC);
      gl.uniform4fv(u.uTap, U.taps);
      gl.uniform2f(u.uCenter, U.center[0], U.center[1]); gl.uniform1f(u.uScale, U.scale); gl.uniform1f(u.uReach, U.reach); gl.uniform1f(u.uY0, U.y0);
      gl.uniform4fv(u.uBand, U.band);
      gl.uniform1f(u.uCutAge, U.cutAge); if (U.cutAge >= 0) gl.uniform4fv(u.uCut, U.cut);
      gl.uniform1f(u.uPawOn, U.pawOn); if (U.pawOn) gl.uniform4fv(u.uPaw, U.paw);
      if (u.uP) gl.uniform4fv(u.uP, U.P);
      gl.uniform2f(u.uShake, U.shake[0], U.shake[1]); gl.uniform1f(u.uBlack, U.black);
      if (u.uEdge){ gl.uniform4fv(u.uEdge, U.edges); gl.uniform2fv(u.uEdgeT, U.edgeT); gl.uniform1i(u.uEdgeN, U.edgeN); }
      quad();
      gl.useProgram(P.down.p);
      gl.uniform1f(P.down.u.uThr, 1.1*ENC); gl.uniform1f(P.down.u.uKnee, .5*ENC); gl.uniform1i(P.down.u.uSrc, 0);
      gl.activeTexture(gl.TEXTURE0);
      let src = sceneT;
      mips.forEach((m,i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb); gl.viewport(0,0,m.w,m.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(P.down.u.uTexel, 1/src.w, 1/src.h); gl.uniform1i(P.down.u.uPre, i===0?1:0);
        quad(); src = m;
      });
      gl.useProgram(P.up.p); gl.uniform1i(P.up.u.uSrc, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i=mips.length-2;i>=0;i--){
        const d = mips[i], s = mips[i+1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0,0,d.w,d.h);
        gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.uniform2f(P.up.u.uTexel, 1/s.w, 1/s.h);
        quad();
      }
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,cw,ch);
      gl.useProgram(P.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneT.tex); gl.uniform1i(P.comp.u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (mips[0]||sceneT).tex); gl.uniform1i(P.comp.u.uBloom, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(P.comp.u.uBloomK, mips.length ? .085 : 0); gl.uniform1f(P.comp.u.uExp, 1.05); gl.uniform1f(P.comp.u.uTime, U.time); gl.uniform1f(P.comp.u.uEnc, ENC);
      gl.uniform1f(P.comp.u.uCAk, U.caK); gl.uniform1f(P.comp.u.uInvert, U.invert);
      quad();
    },
    dispose(){ drop(sceneT); mips.forEach(drop); sceneT=null; mips=[]; try{ gl.getExtension('WEBGL_lose_context')?.loseContext(); }catch(_){} }
  };
  return R;
}

/* ───────────────────────── 状态 ───────────────────────── */
const DUR = {ignite:3.4, collapse:1.5, mitosis:5.2, neural:4.6, ecg:3.6, entry:3.8, vortex:2.3, links:2.4};
const S = {
  running:false, paused:false, modal:false, raf:0, canvas:null, R:null, abort:null,
  scene:null, taps:[], cut:null, paw:null, band:null,
  entry:null, lastInteract:0, trauma:0, tremble:0, lastRender:0, timers:new Set(), marked:new Set(), pref:'auto', levels:[.5,.62,.75,.88,1], qi:2,
  last:0, lastDraw:0, acc:0, frames:0, good:0, t0:clock(), press:null, triple:[],
  lock:false, tscale:1, vt:(performance.now()/1000)%1000, plunge:null
};
const U = {time:0, t:0, taps:new Float32Array(16), center:[0,0], scale:1, reach:.85, y0:0,
  band:new Float32Array(4), cut:new Float32Array(4), cutAge:-1, paw:new Float32Array(4), pawOn:0,
  edges:new Float32Array(48), edgeT:new Float32Array(24), edgeN:0, P:new Float32Array(24), shake:[0,0], black:0, invert:0, caK:1};

function later(fn, ms){ const id = setTimeout(() => { S.timers.delete(id); if (S.running) fn(); }, ms); S.timers.add(id); return id; }
function field(x, y){ return [(x - innerWidth/2)/innerHeight, (innerHeight/2 - y)/innerHeight]; }
function centerOf(el){ const r = el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2, r}; }
function onScreen(r){ return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
function targets(){ return (host()?.targets?.() || []).filter(el => el.isConnected && onScreen(el.getBoundingClientRect())); }
function reach(fx, fy){ const hw = .5*innerWidth/innerHeight; return Math.max(...[[-hw,-.5],[hw,-.5],[-hw,.5],[hw,.5]].map(([x,y]) => Math.hypot(x-fx, y-fy))) + .04; }

function mark(el, cls, ms){
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); S.marked.add(el);
  if (ms) setTimeout(() => el.classList.remove(cls), ms);
}
function zap(el, ms = 750){ if (!reduced()) mark(el, 'xk-zap', ms); }
function thump(){ const app = document.querySelector('.app'); if (app && !reduced()) mark(app, 'xk-thump', 160); }
function clearMarks(){ S.marked.forEach(el => el.classList.remove('xk-zap','xk-hidden','xk-thump','xk-wait')); S.marked.clear(); document.body.classList.remove('xk-revealing','xk-celebrate'); }

/* ───────────────────────── 场景调度 ───────────────────────── */
function clearAction(){
  S.timers.forEach(clearTimeout); S.timers.clear();
  if (S.entry) endEntry(false);
  if (S.plunge) endPlunge();
  S.scene = null; U.edgeN = 0; U.P.fill(0); clearMarks(); S.tscale = 1;
}
function begin(kind, opt = {}){
  if (!S.running || reduced()) return false;
  if (S.lock && !opt.force) return false;     // 不可跳过的转场期间，别的特效一律不插队
  clearAction();
  S.scene = {kind, start:clock(), dur:opt.dur || DUR[kind] || 2, center:opt.center || [0,0], scale:opt.scale || 1, reach:opt.reach || .85, y0:opt.y0 ?? 0, role:opt.role || kind, update:opt.update || null, last:0};
  S.paused = false; S.lastInteract = clock(); document.body.classList.remove('optical-paused');
  later(() => { if (S.scene && S.scene.kind === kind) S.scene = null; }, S.scene.dur*1000 + 30);
  wake();
  return true;
}
function stop(){
  const role = S.scene?.role;
  if (S.plunge) endPlunge();
  clearAction();
  if (role === 'portal') host()?.finishTransition?.();
  if (role === 'exit') host()?.exit?.({immediate:true});
}

function ignite(point, role = 'startup', dur = DUR.ignite){
  const c = point && Number.isFinite(point.x) ? field(point.x, point.y) : [0, .02];
  const R = Math.min(reach(c[0], c[1]), 1.25);
  if (!begin('ignite', {center:c, reach:R, dur, role})) return false;
  if (role === 'startup'){
    const list = targets();
    if (list.length){
      document.body.classList.add('xk-revealing');
      list.forEach(el => { el.classList.add('xk-hidden'); S.marked.add(el); });
      list.forEach(el => {
        const m = centerOf(el), f = field(m.x, m.y), d = Math.hypot(f[0]-c[0], f[1]-c[1]);
        const u = 1 - Math.cbrt(Math.max(0, 1 - Math.min(d, R*.99)/R));
        later(() => el.classList.remove('xk-hidden'), Math.max(0, (.12 + .55*u)*dur*1000 - 60));
      });
      later(() => { list.forEach(el => el.classList.remove('xk-hidden')); document.body.classList.remove('xk-revealing'); }, dur*1000*.8);
    }
  }
  return true;
}
function mitosis(center, scale = 1, dur = DUR.mitosis){
  if (!begin('mitosis', {center, scale, dur})) return;
  if (scale >= 1){ later(thump, .395*dur*1000); later(thump, .655*dur*1000); }
}
function mitosisHere(){
  const shell = document.querySelector('.schedule-shell:not([hidden]), .exam-card');
  let c = [0, 0];
  if (shell){ const m = centerOf(shell); if (onScreen(m.r)) c = field(m.x, clamp(m.y, innerHeight*.25, innerHeight*.75)); }
  mitosis(c, innerWidth < 500 ? .9 : 1.1);
}
function neural(){
  const els = targets().map(el => ({el, ...centerOf(el)}))
    .sort((a,b) => Math.hypot(a.x-innerWidth/2, a.y-innerHeight/2) - Math.hypot(b.x-innerWidth/2, b.y-innerHeight/2)).slice(0, 9);
  let nodes = els.map(n => ({el:n.el, f:field(n.x, n.y)}));
  if (nodes.length < 3){
    const hw = .5*innerWidth/innerHeight;
    nodes = [[-.5,.15],[.3,.22],[-.1,-.05],[.45,-.2],[-.35,-.28]].map(([x,y]) => ({el:null, f:[x*hw*1.5, y]}));
  }
  // 最小生成树：从最靠上的节点出发，每次连最近的未连节点
  const root = nodes.reduce((a,b) => a.f[1] > b.f[1] ? a : b);
  const inTree = new Set([root]), edges = [];
  while (inTree.size < nodes.length && edges.length < 10){
    let best = null;
    for (const a of inTree) for (const b of nodes) if (!inTree.has(b)){
      const d = Math.hypot(a.f[0]-b.f[0], a.f[1]-b.f[1]);
      if (!best || d < best.d) best = {a, b, d};
    }
    inTree.add(best.b); edges.push(best);
  }
  const dur = DUR.neural, arrive = new Map([[root, .15 + .35]]);
  const list = [{a:[root.f[0]-.08, .62], b:root.f, start:.15, len:0}];
  list[0].len = Math.hypot(list[0].b[0]-list[0].a[0], list[0].b[1]-list[0].a[1]);
  list[0].dur = .16 + list[0].len*.9; arrive.set(root, .15 + list[0].dur);
  for (const e of edges){
    const start = arrive.get(e.a), d = .16 + e.d*.9;
    list.push({a:e.a.f, b:e.b.f, start, dur:d}); arrive.set(e.b, start + d);
  }
  if (!begin('neural', {dur})) return;
  U.edges.fill(0); U.edgeT.fill(0);
  list.slice(0,12).forEach((e,i) => { U.edges.set([e.a[0],e.a[1],e.b[0],e.b[1]], i*4); U.edgeT.set([e.start/dur, e.dur/dur], i*2); });
  U.edgeN = Math.min(12, list.length);
  arrive.forEach((t, n) => { if (n.el) later(() => zap(n.el), t*1000); });
}
function ecg(){
  const dur = DUR.ecg;
  if (!begin('ecg', {dur, y0:0})) return;
  [0,1].forEach(k => later(() => { thump(); targets().forEach(el => zap(el, 420)); }, (.05+.8*((k+.33)/2))*dur*1000));
}

/* 叠加层：涟漪 / 光带 / 光刀 / 猫爪，与场景共存 */
function ripple(x, y, strength = 1){
  if (!S.running || reduced()) return;
  const [fx, fy] = field(x, y);
  S.taps.push({x:fx, y:fy, t:clock(), s:strength}); if (S.taps.length > 4) S.taps.shift();
  wake();
}
function sweep(direction){
  if (!S.running || reduced()) return;
  const hw = .5*innerWidth/innerHeight;
  S.band = {kind:'sweep', from:-direction*(hw+.12), to:direction*(hw+.12), w:.05, t:clock(), dur:.7};
  wake();
}
function beam(fx, halfWidth){
  if (!S.running || reduced()) return;
  S.band = {kind:'beam', x:fx, w:Math.max(.02, halfWidth), t:clock(), dur:2.2};
  wake();
}
function cut(x1, y1, x2, y2){
  if (!S.running || reduced()) return;
  const a = field(x1, y1), b = field(x2, y2);
  S.cut = {v:[a[0],a[1],b[0],b[1]], t:clock()}; wake();
  slash(x1, y1, x2, y2);
}
// 刀光划过的课程卡：沿刀口两侧被震开、闪一下，再弹回原位
function slash(x1, y1, x2, y2){
  const len = Math.hypot(x2-x1, y2-y1); if (len < 1) return;
  const ux = (x2-x1)/len, uy = (y2-y1)/len, nx = -uy, ny = ux;
  targets().forEach(el => {
    const v = el.querySelector('.course-visual') || el, r = v.getBoundingClientRect();
    const cx = r.left+r.width/2, cy = r.top+r.height/2;
    const along = (cx-x1)*ux + (cy-y1)*uy, side = (cx-x1)*nx + (cy-y1)*ny;
    const half = Math.abs(r.width/2*nx) + Math.abs(r.height/2*ny);
    if (along < -r.width/2 || along > len + r.width/2 || Math.abs(side) > half + 4 || !v.animate) return;
    const sg = side >= 0 ? 1 : -1, push = 10 + 8*(1 - Math.min(1, Math.abs(side)/(half+1)));
    const tx = (nx*sg*push).toFixed(1), ty = (ny*sg*push).toFixed(1), rot = (sg*(4 + (along % 5))).toFixed(1);
    try {
      v.animate([
        {transform:'none', filter:'none'},
        {transform:`translate(${tx}px,${ty}px) rotate(${rot}deg) scale(.97)`, filter:'brightness(2.6)', offset:.18},
        {transform:`translate(${(-tx*.25).toFixed(1)}px,${(-ty*.25).toFixed(1)}px) rotate(${(-rot*.3).toFixed(1)}deg)`, filter:'brightness(1.3)', offset:.5},
        {transform:'none', filter:'none'}
      ], {duration:720, delay:Math.max(0, along/len)*140, easing:'cubic-bezier(.2,.7,.3,1)'});
    } catch (_) {}
  });
  S.trauma = Math.max(S.trauma, .35);
}
function paws(from, to){
  if (!S.running || reduced()) return;
  const hw = .5*innerWidth/innerHeight;
  from = from || [-hw*.55, -.34]; to = to || [hw*.45, .36];
  S.paw = {v:[from[0], from[1], Math.atan2(to[1]-from[1], to[0]-from[0])], t:clock()}; wake();
}

/* ───────────────────────── 每帧 ───────────────────────── */
function level(){ return S.pref === 'smooth' ? .5 : S.pref === 'rich' ? 1 : S.levels[S.qi]; }
function sizeCanvas(){
  const dpr = Math.min(devicePixelRatio || 1, S.pref === 'smooth' ? 1.5 : 2);
  const W = Math.max(1, Math.round(innerWidth*dpr)), H = Math.max(1, Math.round(innerHeight*dpr)), l = level();
  S.R.size(W, H, Math.max(1, Math.round(W*l)), Math.max(1, Math.round(H*l)), S.pref === 'smooth' ? 4 : 6);
}
function active(now){
  return !!(S.scene || S.cut || S.paw || S.band || S.trauma > .01 || S.taps.some(t => now - t.t < 3));
}
function render(ms){
  if (!S.R || S.R.lost) return;
  const now = clock(), rdt = S.lastRender ? Math.min(.1, now - S.lastRender) : 0;
  S.lastRender = now;
  sizeCanvas();
  S.vt += rdt*S.tscale; U.time = S.vt;       // 虚拟时间：子弹时间里光场一起变慢
  U.black = 0; U.invert = 0; U.caK = 1; S.tremble = 0;
  const sc = S.scene;
  U.t = sc ? clamp((now - sc.start)/sc.dur) : 0;
  U.center = sc?.center || [0,0]; U.scale = sc?.scale || 1; U.reach = sc?.reach || .85; U.y0 = sc?.y0 || 0;
  U.taps.fill(0);
  S.taps = S.taps.filter(t => now - t.t < 3);
  S.taps.forEach((t,i) => U.taps.set([t.x, t.y, now - t.t, t.s], i*4));
  U.band.fill(0);
  if (S.band){
    const b = S.band, a = (now - b.t)/b.dur;
    if (a >= 1) S.band = null;
    else if (b.kind === 'sweep'){ const e = 1 - Math.pow(1-a, 2); U.band.set([b.from + (b.to-b.from)*e, b.w, Math.sin(Math.PI*a)*1.2, 0]); }
    else U.band.set([b.x, b.w, Math.min(1, a*6) * Math.pow(1-a, 1.6) * .9, 0]);
  }
  U.cutAge = -1;
  if (S.cut){ const a = now - S.cut.t; if (a > 3) S.cut = null; else { U.cut.set(S.cut.v); U.cutAge = a; } }
  U.pawOn = 0;
  if (S.paw){ const a = now - S.paw.t; if (a > 4.5) S.paw = null; else { U.paw.set([...S.paw.v, a]); U.pawOn = 1; } }
  if (sc?.update){ const e = Math.min(now - sc.start, sc.dur); sc.update(e, Math.max(0, Math.min(.1, e - sc.last))); sc.last = e; }
  applyShake(now, rdt);
  S.R.draw(sc ? sc.kind : 'idle', U);
}
// 震动：trauma 0~1，取平方后乘最大幅度（小震几乎察觉不到，大震才有力），用几路正弦叠加代替随机抖
function applyShake(now, dt){
  S.trauma = Math.max(0, S.trauma - dt*1.5);
  const a = Math.max(S.trauma, S.tremble), t2 = a*a, app = appEl();
  if (t2 < .0004 || reduced()){
    U.shake = [0,0];
    if (app && app.style.translate){ app.style.translate = ''; app.style.rotate = ''; }
    return;
  }
  const nx = Math.sin(now*41)*.6 + Math.sin(now*67+1.7)*.4, ny = Math.sin(now*53+.8)*.6 + Math.sin(now*29+2.3)*.4, nr = Math.sin(now*37+4.1);
  const px = 12*t2*nx, py = 10*t2*ny;
  U.shake = [px/innerHeight*.8, -py/innerHeight*.8];
  if (app){ app.style.translate = `${px.toFixed(2)}px ${py.toFixed(2)}px`; app.style.rotate = `${(1.1*t2*nr).toFixed(3)}deg`; }
}
function loop(ms){
  S.raf = 0;
  if (!S.running || S.paused || document.hidden || !S.R || S.R.lost) return;
  S.raf = requestAnimationFrame(loop);
  const now = clock(), busy = active(now);
  // 待机 30 帧、弹窗时 15 帧，省电
  const idleLong = now - S.lastInteract > 20;
  const gap = busy ? 0 : S.modal ? 64 : idleLong ? 80 : 31;
  if (ms - S.lastDraw < gap) return;
  const dt = S.last ? ms - S.last : 16; S.last = ms; S.lastDraw = ms;
  render(ms);
  if (!busy || S.pref !== 'auto') { S.acc = S.frames = 0; return; }
  S.acc += dt; S.frames++;
  if (S.acc >= 1000){
    const fps = S.frames*1000/S.acc;
    if (fps < 45 && S.qi > 0) { S.qi--; S.good = 0; }
    else if (fps > 57 && S.qi < S.levels.length-1 && ++S.good > 2) { S.qi++; S.good = 0; }
    S.acc = S.frames = 0;
  }
}
function wake(){
  if (!S.running || S.paused || document.hidden || !S.R || reduced()) return;
  if (!S.raf){ S.last = 0; S.raf = requestAnimationFrame(loop); }
}
function staticFrame(){ if (S.R && !S.R.lost){ clearAction(); S.taps = []; S.cut = S.paw = S.band = null; render(12000); } }

/* ───────────────────────── 输入与彩蛋 ───────────────────────── */
const PLAIN = 'button,a,input,select,textarea,label,[role="button"],.course,.exam-item,.exam-orb,.dialog,.sheet-grip,.study-materials';
function usable(){ return S.running && !S.paused && !S.modal && !S.lock && !reduced(); }
function onPointerDown(e){
  S.lastInteract = clock();
  if (S.entry && S.running){ skipEntry(e.clientX, e.clientY); return; }
  if (S.lock && S.running && !reduced()){ ripple(e.clientX, e.clientY, .6); return; }   // 转场中点屏幕：只泛起涟漪，不能跳过
  if (!usable()) return;
  ripple(e.clientX, e.clientY, e.target.closest?.('button,[role="button"]') ? .7 : 1);
  const card = e.target.closest?.('.course,.exam-item');
  if (card) zap(card, 600);
  clearTimeout(S.press?.timer); S.press = null;
  // 课表网格左右划是切周，弹窗里是正常操作：这两处不参与任何手势彩蛋
  if (e.target.closest?.('.schedule-shell,.dialog,.sheet-grip,input,textarea,select')) return;
  const now = performance.now();
  S.press = {id:e.pointerId, type:e.pointerType, x:e.clientX, y:e.clientY, t:now, scroll:scrollY, moved:false};
  // 长按、连点只认空白处，避免和按钮、课程卡的点击冲突；快速划可以从任何地方起手
  if (e.target.closest?.(PLAIN)) { S.triple = []; return; }
  // 连点空白处三下：原地分裂出一个小细胞
  S.triple = S.triple.filter(t => now - t.t < 600 && Math.hypot(t.x-e.clientX, t.y-e.clientY) < 48);
  S.triple.push({t:now, x:e.clientX, y:e.clientY});
  if (S.triple.length >= 3){ S.triple = []; mitosis(field(e.clientX, e.clientY), .5, 4.2); }
  // 长按空白处：心电扫描
  S.press.timer = setTimeout(() => { if (S.press && !S.press.moved && usable()) { S.press.fired = true; ecg(); } }, 550);
}
function onPointerMove(e){
  const p = S.press; if (!p || e.pointerId !== p.id) return;
  if (Math.hypot(e.clientX-p.x, e.clientY-p.y) > 12){ p.moved = true; clearTimeout(p.timer); }
}
function swipeEnd(x, y){
  const p = S.press; S.press = null; if (!p) return;
  clearTimeout(p.timer);
  const dist = Math.hypot(x-p.x, y-p.y), dt = performance.now() - p.t;
  // 快速划过（不在课表网格里、页面没有滚动）：光刀
  if (!p.fired && dist > 90 && dt < 420 && Math.abs(scrollY - p.scroll) < 4 && usable()) cut(p.x, p.y, x, y);
}
function onPointerUp(e){ if (S.press?.type === 'mouse' && e.pointerId === S.press.id) swipeEnd(e.clientX, e.clientY); else if (S.press) clearTimeout(S.press.timer); }
function onPointerCancel(){ if (S.press) { clearTimeout(S.press.timer); S.press.moved = true; } }
function onTouchEnd(e){ const t = e.changedTouches?.[0]; if (t && S.press && S.press.type !== 'mouse') swipeEnd(t.clientX, t.clientY); }

/* ───────────────────────── 画布与主题色 ───────────────────────── */
const themeMetas = () => Array.from(document.querySelectorAll('meta[name="theme-color"]'));
function setThemeColor(v){ for (const m of themeMetas()){ if (m.dataset.base === undefined) m.dataset.base = m.getAttribute('content') || ''; m.setAttribute('content', v); } }
function restoreThemeColor(){ for (const m of themeMetas()){ if (m.dataset.base !== undefined){ m.setAttribute('content', m.dataset.base); delete m.dataset.base; } } }

function initGL(){
  try { S.R = createRenderer(S.canvas); }
  catch (err) { console.warn('[小克版] 光场初始化失败，使用纯暗场', err); S.R = null; }
  if (!S.R) { S.canvas.classList.add('xk-static'); return; }
  S.canvas.classList.remove('xk-static');
  sizeCanvas(); render(performance.now());
}
function mountCanvas(){
  if (S.canvas) return;
  const c = document.createElement('canvas');
  c.className = 'xk-canvas'; c.dataset.showcaseOwned = 'true'; c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c); S.canvas = c;
  c.addEventListener('webglcontextlost', e => { e.preventDefault(); if (S.R) S.R.lost = true; cancelAnimationFrame(S.raf); S.raf = 0; }, {signal:S.abort.signal});
  c.addEventListener('webglcontextrestored', () => { initGL(); wake(); }, {signal:S.abort.signal});
  initGL();
}

/* ───────────────────────── 对外接口 ───────────────────────── */
function mount(opt = {}){
  if (S.running) return;
  S.running = true; S.paused = false; S.modal = false;
  S.abort = new AbortController();
  try { S.pref = localStorage.getItem('scheduleQuality') || 'auto'; } catch (_) {}
  S.qi = navigator.connection?.saveData ? 0 : 2;
  document.body.classList.add('optical-on');
  if (!opt.light){ document.documentElement.classList.add('dark-field'); setThemeColor('#0b0816'); }
  mountCanvas();
  if (opt.light) S.canvas?.classList.add('xk-light');
  const o = {passive:true, signal:S.abort.signal};
  document.addEventListener('pointerdown', onPointerDown, o);
  document.addEventListener('pointermove', onPointerMove, o);
  document.addEventListener('pointerup', onPointerUp, o);
  document.addEventListener('pointercancel', onPointerCancel, o);
  document.addEventListener('touchend', onTouchEnd, o);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.scene && !S.modal && !S.lock) stop(); }, {signal:S.abort.signal});
  if (reduced()) staticFrame(); else wake();
}
function destroy(){
  S.trauma = 0; S.tremble = 0; const shaken = appEl(); if (shaken){ shaken.style.translate = ''; shaken.style.rotate = ''; }
  if (S.entry){ const E = S.entry; S.entry = null; E.anims.concat(E.cards).forEach(a => { try { a.cancel(); } catch (_) {} }); const app = appEl(); if (app) app.style.transformOrigin = ''; }
  if (S.plunge) endPlunge();
  clearAction();
  S.running = false; S.paused = false; S.modal = false;
  cancelAnimationFrame(S.raf); S.raf = 0;
  clearTimeout(S.press?.timer); S.press = null; S.triple = [];
  S.abort?.abort(); S.abort = null;
  S.taps = []; S.cut = S.paw = S.band = null;
  S.R?.dispose(); S.R = null;
  S.canvas?.remove(); S.canvas = null;
  document.body.classList.remove('optical-on','optical-paused','xk-revealing','xk-celebrate','xk-entering');
  document.documentElement.classList.remove('dark-field');
  restoreThemeColor();
}
function resize(){ if (S.R) { sizeCanvas(); if (!S.raf) render(performance.now()); } }
function sync(){}
function pause(){ S.paused = true; cancelAnimationFrame(S.raf); S.raf = 0; document.body.classList.add('optical-paused'); }
function resume(){ if (!S.running) return; S.paused = false; document.body.classList.toggle('optical-paused', S.modal); if (reduced()) staticFrame(); else wake(); }
function setModal(v){ S.modal = !!v; document.body.classList.toggle('optical-paused', S.modal || S.paused); S.canvas?.classList.toggle('dimmed', S.modal); if (S.modal) { clearTimeout(S.press?.timer); S.press = null; } }
function qualityChanged(v){ S.pref = ['auto','smooth','rich'].includes(v) ? v : 'auto'; S.good = 0; resize(); }
function motionChanged(){ if (!S.running) return; if (reduced()) { cancelAnimationFrame(S.raf); S.raf = 0; staticFrame(); } else wake(); }

/* ───────────────────────── 开场：吞噬 → 爆闪 → 曲速 → 落位 → 锁定 ───────────────────────── */
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const easeInOut = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
function appEl(){ return document.querySelector('.app'); }
// 开场时间线（秒）：蓄力 → 坍缩 → 黑帧 → 反色冲击帧 → 爆发 → 曲速 → 齐射落地（带顿帧）→ 安静
const TL = {charge:.85, collapse:1.05, black:1.11, burst:1.16, reveal:2.3, launch:2.55, impact:2.87, end:3.8};
function entry(origin, replay = false){
  const app = appEl(), dur = TL.end;
  const pt = origin && Number.isFinite(origin.x) ? origin : {x:innerWidth/2, y:innerHeight*.28};
  const c = field(pt.x, pt.y);
  const E = {anims:[], cards:[], travel:0, inTravel:0, swapped:false, burst:false, impact:false, replay, c, tc:[0,.02]};
  if (!begin('warp', {center:c, dur, role:'entry', update:(s, dt) => entryFrame(E, s, dt)})) return 0;
  S.entry = E;
  document.body.classList.add('xk-entering');
  if (app?.animate){
    const r = app.getBoundingClientRect();
    app.style.transformOrigin = `${pt.x - r.left}px ${pt.y - r.top}px`;
    // 预备动作：先往后缩、变暗（被那一点吸着），然后一瞬间被拽进去
    E.anims.push(app.animate([
      {transform:'none', filter:'none', opacity:1},
      {transform:'scale(.965)', filter:'brightness(.82) saturate(.8)', opacity:1, offset:TL.charge/TL.collapse, easing:'cubic-bezier(.75,0,1,.3)'},
      {transform:'scale(.01) rotate(-130deg)', filter:'blur(8px) brightness(2)', opacity:0}
    ], {duration:TL.collapse*1000, easing:'cubic-bezier(.3,0,.7,1)', fill:'forwards'}));
  }
  later(() => entrySwap(E), TL.collapse*1000);
  later(() => entryLaunch(E), TL.launch*1000);
  later(() => endEntry(true), dur*1000);
  return dur*1000;
}
function entryFrame(E, s, dt){
  const charge = s < TL.charge ? smooth(0, TL.charge, s) : s < TL.collapse ? 1 : 0;
  const light = !E.replay && s < TL.collapse ? 1 - .55*smooth(0, TL.charge, s) : 0;
  const rh = s < TL.charge ? 0 : s < 1.0 ? .02 + .15*smooth(TL.charge, 1.0, s) : s < TL.collapse ? .17*(1 - smooth(1.0, TL.collapse, s)) : 0;
  U.black = s >= TL.collapse && s < TL.black ? 1 : 0;
  U.invert = s >= TL.black && s < TL.burst ? 1 : 0;
  const flash = s >= TL.burst ? Math.exp(-(s-TL.burst)*12)*1.2 : 0;
  const speed = s < TL.black ? 0 : s < 1.35 ? easeInOut((s-TL.black)/.24) : s < 2.1 ? 1 : s < TL.launch ? 1 - easeInOut((s-2.1)/.45) : 0;
  const kick = .45*Math.exp(-Math.pow((s-1.75)*6, 2));            // 跃迁中途猛地再提一次速
  E.travel += (speed + kick*.5)*dt*1.3;
  if (s < TL.collapse) E.inTravel -= dt*(.5 + 2.2*charge);
  const tun = smooth(TL.black, 1.18, s)*(1 - smooth(2.35, 2.75, s));
  const amb = s < TL.collapse ? (E.replay ? 1 - .5*charge : 0) : s < 2.6 ? .15 : .15 + .85*smooth(2.6, 3.4, s);
  const k = easeInOut(clamp((s-TL.black)/.4));
  const tcx = E.c[0] + (E.tc[0]-E.c[0])*k, tcy = E.c[1] + (E.tc[1]-E.c[1])*k;
  let rect = [0,0,0,0];
  const shell = document.querySelector('.schedule-shell:not([hidden])');
  if (shell && s > TL.impact - .05){ const r = shell.getBoundingClientRect(); const a = field(r.left, r.top), b = field(r.right, r.bottom); rect = [(a[0]+b[0])/2, (a[1]+b[1])/2, Math.abs(b[0]-a[0])/2, Math.abs(a[1]-b[1])/2]; }
  const glow = rect[2] && s > TL.impact ? Math.exp(-(s-TL.impact)*4.5) : 0;
  U.caK = 1 + (s > TL.black ? 7*Math.exp(-(s-TL.black)*7) : 0) + (s > TL.impact ? 4*Math.exp(-(s-TL.impact)*9) : 0);
  S.tremble = s < TL.charge ? .12 + .5*charge : s < TL.collapse ? .62 : 0;
  if (!E.burst && s >= TL.burst){ E.burst = true; S.trauma = 1; }
  U.P.set([light, rh, flash, s > TL.black ? s-TL.black : -1, E.travel, speed, tun, amb, ...rect, 0, 0, glow, charge, tcx, tcy, E.inTravel, kick], 0);
}
function entrySwap(E){
  if (S.entry !== E) return;
  E.swapped = true;
  // 黑帧里切主题，肉眼看不到硬切
  document.documentElement.classList.add('dark-field');
  setThemeColor('#0b0816');
  S.canvas?.classList.remove('xk-light');
  const app = appEl();
  E.cardEls = (host()?.targets?.() || []).filter(el => el.isConnected);
  E.cardEls.forEach(el => { el.classList.add('xk-wait'); S.marked.add(el); });
  if (app?.animate){
    const total = (TL.impact - TL.collapse)*1000, hold = (TL.reveal - TL.collapse)*1000;
    const back = app.animate([
      {transform:'scale(1.1)', filter:'blur(10px)', opacity:0},
      {transform:'scale(1.1)', filter:'blur(10px)', opacity:0, offset:hold/total},
      {transform:'none', filter:'none', opacity:1}
    ], {duration:total, easing:'cubic-bezier(.2,.8,.2,1)'});
    E.anims.forEach(a => a.cancel()); E.anims = [back];
    app.style.transformOrigin = '';
  }
}
// 所有课程卡同时从隧道中心射出，在同一帧砸回格子；砸中后顿一下（顿帧）再回弹
function entryLaunch(E){
  if (S.entry !== E) return;
  const tx = innerWidth/2 + E.tc[0]*innerHeight, ty = innerHeight/2 - E.tc[1]*innerHeight;
  const flight = 400, hitAt = .8;
  (E.cardEls || []).forEach((el, i) => {
    if (!el.isConnected) return;
    el.classList.remove('xk-wait');
    const v = el.querySelector('.course-visual') || el;
    const r = v.getBoundingClientRect(); if (!r.width || !v.animate) return;
    const dx = tx - (r.left + r.width/2), dy = ty - (r.top + r.height/2), rot = (i % 2 ? 1 : -1)*(18 + (i*37 % 24));
    E.cards.push(v.animate([
      {transform:`translate(${dx}px,${dy}px) scale(.06) rotate(${rot}deg)`, opacity:0, filter:'blur(4px) brightness(3)', easing:'cubic-bezier(.5,0,.9,.55)'},
      {opacity:1, offset:.25},
      {transform:'scale(1.08,.9)', filter:'brightness(2.2)', opacity:1, offset:hitAt, easing:'linear'},
      {transform:'scale(1.08,.9)', filter:'brightness(2.2)', opacity:1, offset:hitAt + .12},
      {transform:'none', filter:'none', opacity:1}
    ], {duration:flight, fill:'backwards'}));
  });
  later(() => {
    if (S.entry !== E) return;
    E.impact = true; S.trauma = .8;
    const shell = document.querySelector('.schedule-shell:not([hidden])');
    const m = shell ? centerOf(shell) : {x:innerWidth/2, y:innerHeight/2};
    ripple(m.x, m.y, 1.8);
    (E.cardEls || []).forEach(el => zap(el, 600));
  }, flight*hitAt);
}
function endEntry(natural){
  const E = S.entry; if (!E) return;
  S.entry = null;
  document.body.classList.remove('xk-entering');
  E.anims.forEach(a => { try { a.cancel(); } catch (_) {} });
  E.cards.forEach(a => { try { a.cancel(); } catch (_) {} });
  const app = appEl(); if (app){ app.style.transformOrigin = ''; }
  if (!E.swapped){ document.documentElement.classList.add('dark-field'); setThemeColor('#0b0816'); S.canvas?.classList.remove('xk-light'); }
  S.marked.forEach(el => el.classList.remove('xk-wait'));
  if (natural){ S.scene = null; U.P.fill(0); }
  host()?.completeEntry?.();
}
// 开场中点一下：直接跳到结尾
function skipEntry(x, y){
  if (!S.entry) return;
  S.timers.forEach(clearTimeout); S.timers.clear();
  endEntry(false);
  S.scene = null; U.P.fill(0); clearMarks();
  ripple(x, y, 1);
}
function playStartup(origin){
  if (reduced()){ mount(); return 20; }
  mount({light:true});
  if (!S.R){ document.documentElement.classList.add('dark-field'); setThemeColor('#0b0816'); return 600; }
  return entry(origin, false);
}
function play(action){
  if (!S.running) return;
  if (['startup','warp','storm'].includes(action)) return void entry(null, true);
  if (['ignite','prism'].includes(action)) return void ignite(null, 'startup');
  if (['mitosis','overdrive','gravity','fold'].includes(action)) return mitosisHere();
  if (['neural','lightning','resonance','pixel'].includes(action)) return neural();
  if (['ecg','scan'].includes(action)) return ecg();
  if (['singularity','crystal'].includes(action)) return singularity();
}
function beginExit(origin){
  const r = document.getElementById('courseModeBadge')?.getBoundingClientRect();
  const pt = origin || (r && r.width ? {x:r.left+r.width/2, y:r.top+r.height/2} : {x:innerWidth/2, y:60});
  const c = field(pt.x, pt.y);
  begin('collapse', {center:c, reach:Math.min(reach(c[0], c[1]), 1.25), role:'exit'});
}
// 实验模式切页：坠入水晶球（约 5.4 秒，不可跳过）
// 起势：课程卡一张张脱离格子，绕着奇点旋转 → 奇点：黑洞成形，卡片被拉长吸入
// → 子弹时间：吸入前最后一刻几乎静止 → 黑帧 / 反色帧 / 冲击 → 水晶内部 → 凝晶光环扫过，新页面逐个结晶成形
const PT = {rise:1.3, sing:2.3, slow:2.68, black:2.72, invert:2.77, burst:2.82, land:4.05, ring:4.15, settle:4.9, end:5.4};
const PORTAL_PULL = PT.black, PORTAL_SWAP = 2.74, PORTAL_LAND = PT.land, PORTAL_END = PT.end, RING_V = 1.35;
function holePoint(){ return {x:innerWidth/2, y:innerHeight*.46}; }
// 卡片吸入的进度：前慢后快，奇点处进入子弹时间，最后 0.04 秒一口吞下
function suckProgress(u){
  if (u < PT.sing) return .93*Math.pow(u/PT.sing, 2.1);
  if (u < PT.slow) return .93 + .025*smooth(PT.sing, PT.slow, u);
  return Math.min(1, .955 + .045*smooth(PT.slow, PT.black, u));
}
function suckCards(list, hole, dir){
  const items = list.map(el => {
    const v = el.querySelector?.('.course-visual') || el, r = v.getBoundingClientRect();
    return {v, r, cx:r.left+r.width/2, cy:r.top+r.height/2};
  }).filter(o => o.r.width && o.v.animate && onScreen(o.r));
  if (!items.length) return [];
  const maxR = Math.max(...items.map(o => Math.hypot(o.cx-hole.x, o.cy-hole.y)), 1);
  const N = 46, total = PT.black;
  return items.map((o, idx) => {
    const dx0 = o.cx-hole.x, dy0 = o.cy-hole.y, r0 = Math.hypot(dx0, dy0), a0 = Math.atan2(dy0, dx0);
    const start = .62*(r0/maxR) + (idx % 3)*.04;          // 离奇点越近越先被拽走
    const frames = [];
    for (let k = 0; k <= N; k++){
      const t = total*k/N;
      const u = t < PT.sing ? Math.max(0, t-start)/(PT.sing-start)*PT.sing : t;
      const p = suckProgress(u);
      const r = r0*Math.pow(1-p, 1.25), a = a0 + dir*Math.PI*2*1.6*Math.pow(p, 1.8);
      const w = smooth(.62, .96, p), pop = smooth(0, .06, p)*(1 - smooth(.08, .35, p));
      const sc = (1 + .1*pop)*(1 - .62*smooth(.25, .95, p));
      const rot = ((a-a0)*.35*(1-w) + a*w)*180/Math.PI;
      frames.push({offset:k/N, opacity:1 - smooth(.955, 1, p),
        transform:`translate(${(hole.x + r*Math.cos(a) - o.cx).toFixed(1)}px,${(hole.y + r*Math.sin(a) - o.cy).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${(sc*(1+2.8*w)).toFixed(3)},${(sc/(1+2.5*w)).toFixed(3)})`,
        filter:`brightness(${(1 + .5*pop + 2.5*p*p*p).toFixed(2)}) blur(${(w*3).toFixed(2)}px)`});
    }
    return o.v.animate(frames, {duration:total*1000, easing:'linear', fill:'forwards'});
  });
}
// 凝晶：光环从奇点往外扩，扫过哪个元素，哪个元素就从一粒光结晶成形
function crystallize(list, hole, ringAt){
  const out = [];
  list.forEach(el => {
    const v = el.querySelector?.('.course-visual') || el;
    if (!v.animate) return;
    const r = v.getBoundingClientRect(); if (!r.width) return;
    const d = Math.hypot(r.left+r.width/2-hole.x, r.top+r.height/2-hole.y)/innerHeight;
    try {
      out.push(v.animate([
        {opacity:0, transform:'scale(.15) rotate(-12deg)', filter:'brightness(4) blur(6px)'},
        {opacity:1, transform:'scale(1.14) rotate(2deg)', filter:'brightness(2.4) blur(0px)', offset:.35},
        {transform:'scale(.96)', filter:'brightness(1.25)', offset:.65},
        {opacity:1, transform:'none', filter:'none'}
      ], {duration:560, delay:Math.max(0, (ringAt + d/RING_V)*1000), easing:'cubic-bezier(.2,.8,.2,1)', fill:'backwards'}));
    } catch (_) {}
  });
  return out;
}
function plungeFrame(V, s, dt){
  S.tscale = s > PT.sing && s < PT.slow ? .07 : 1;          // 子弹时间
  const vdt = dt*S.tscale;
  const pull = s < PT.black ? .6*smooth(0, PT.rise, s) + .4*smooth(PT.rise, PT.sing, s) : 0;
  V.spin += V.dir*(1.5 + 10*pull)*vdt;
  V.inflow += (.4 + 2.6*pull)*vdt;
  const hole = s < PT.rise*.8 ? 0 : (.01 + .1*smooth(PT.rise*.8, PT.sing, s))*(1 - smooth(PT.slow, PT.black, s));
  const lens = smooth(PT.rise*.8, PT.sing, s);
  const tun = smooth(PT.burst, PT.burst+.25, s)*(1 - smooth(PT.land-.15, PT.land+.2, s));
  const speed = s < PT.burst ? 0 : 1.8*Math.exp(-(s-PT.burst)*1.1) + .35;
  V.travel += speed*vdt;
  const core = smooth(PT.land-.55, PT.land, s)*(1 - smooth(PT.land, PT.ring+.2, s));
  const amb = s < PT.burst ? 1 - .7*pull : s < PT.land ? .12 : .12 + .88*smooth(PT.land, PT.settle, s);
  const burst = s >= PT.burst ? s - PT.burst : -1, ring = s >= PT.ring ? s - PT.ring : -1;
  U.black = s >= PT.black && s < PT.invert ? 1 : 0;
  U.invert = s >= PT.invert && s < PT.burst ? 1 : 0;
  U.caK = 1 + .8*pull + (s > PT.invert ? 7*Math.exp(-(s-PT.invert)*6) : 0) + 1.5*tun + (ring >= 0 ? 1.5*Math.exp(-ring*6) : 0);
  S.tremble = s < PT.sing ? .1 + .45*pull : s < PT.slow ? .12 : s < PT.black ? .75 : 0;
  if (!V.hit && s >= PT.burst){ V.hit = true; S.trauma = 1; }
  if (!V.ringHit && s >= PT.ring){ V.ringHit = true; S.trauma = Math.max(S.trauma, .55); }
  U.P.set([pull, V.spin, hole, lens, V.travel, tun, V.inflow, amb, s >= PT.burst ? Math.exp(-(s-PT.burst)*14)*.8 : 0, burst, ring, RING_V, core, V.dir, 0, 0], 0);
}
function endPlunge(){
  const V = S.plunge; if (!V) return;
  S.plunge = null; S.lock = false; S.tscale = 1;
  V.anims.forEach(a => { try { a.cancel(); } catch (_) {} });
  const app = appEl(); if (app && V.appAnim){ try { V.appAnim.cancel(); } catch (_) {} }
}
function startPlunge(dir, role, origin){
  const hole = holePoint();
  const V = {dir, spin:0, inflow:0, travel:0, anims:[], hole, role};
  if (!begin('crystal', {center:field(hole.x, hole.y), dur:PT.end, role, force:true, update:(s, dt) => plungeFrame(V, s, dt)})) return null;
  if (S.plunge) endPlunge();
  S.plunge = V; S.lock = true;
  if (origin) ripple(origin.x, origin.y, .8);
  later(() => { if (S.plunge === V){ S.lock = false; S.plunge = null; S.tscale = 1; } }, PT.end*1000 + 40);
  return V;
}
function portal(toExam, point, origin){
  const V = startPlunge(toExam ? 1 : -1, 'portal', origin || point);
  if (!V) return false;
  const sucked = suckCards(host()?.portalTargets?.() || [], V.hole, V.dir);
  V.anims = sucked.slice();
  // 旧页面在黑帧里被宿主藏起，吸入动画随之撤掉（新页面的凝晶动画另算）
  later(() => sucked.forEach(a => { try { a.cancel(); } catch (_) {} }), (PORTAL_SWAP + .05)*1000);
  return true;
}
function portalLanding(){
  const V = S.plunge; if (!V || V.role !== 'portal') return;
  const list = (host()?.portalTargets?.() || []).filter(el => el.isConnected).slice(0, 40);
  V.anims.push(...crystallize(list, V.hole, PT.ring - PORTAL_SWAP));
}
// 控制台重播“引力奇点”：不换页，卡片被吸走再原地结晶回来
function singularity(){
  if (!S.running || reduced()) return;
  const V = startPlunge(1, 'singularity');
  if (!V) return;
  const list = targets();
  V.anims = suckCards(list, V.hole, 1);
  const app = appEl();
  if (app?.animate) V.appAnim = app.animate([
    {opacity:1, filter:'none'}, {opacity:.8, filter:'brightness(.75)', offset:PT.sing/PT.end},
    {opacity:0, filter:'blur(6px)', offset:PT.black/PT.end}, {opacity:0, filter:'blur(6px)', offset:PT.land/PT.end},
    {opacity:1, filter:'none', offset:(PT.land+.4)/PT.end}, {opacity:1, filter:'none'}
  ], {duration:PT.end*1000});
  later(() => {
    if (S.plunge !== V) return;
    V.anims.forEach(a => { try { a.cancel(); } catch (_) {} });
    V.anims = crystallize(list, V.hole, PT.ring - PORTAL_SWAP);
  }, PORTAL_SWAP*1000);
}
function travel(direction){ if (usable()) sweep(direction >= 0 ? 1 : -1); }
function view(){
  if (!usable()) return;
  const sw = document.querySelector('.view-switch [aria-pressed="true"]') || document.querySelector('.view-switch');
  if (sw){ const m = centerOf(sw); ripple(m.x, m.y, 1); } else ripple(innerWidth/2, innerHeight*.3, 1);
}
function today(shade){
  if (!S.running || !shade || reduced()) return;
  const r = shade.getBoundingClientRect();
  beam(field(r.left + r.width/2, 0)[0], r.width/2/innerHeight);
  targets().forEach(el => { const m = centerOf(el); if (m.x >= r.left && m.x <= r.right) later(() => zap(el), 200); });
}
function oracle(orb, secret = false){
  if (!S.running || !orb) return;
  const m = centerOf(orb);
  ripple(m.x, m.y, 1);
  if (secret) mitosis(field(m.x, m.y), .55, 4.2);
  else if (!reduced() && begin('crystal', {center:field(m.x, m.y), dur:1.8, role:'orb', update:s => {
    U.P.fill(0); U.P.set([0,0,0,0, 0,0,0,1, 0,-1, s, .75, Math.exp(-s*5)*.5, 1], 0);
  }})) S.trauma = Math.max(S.trauma, .3);
  if (orb.animate && !reduced()) try {
    orb.animate([{transform:'scale(1)'},{transform:'scale(.82) rotate(-12deg)',offset:.3},{transform:'scale(1.14) rotate(8deg)',offset:.6},{transform:'scale(1)'}], {duration:1150, easing:'cubic-bezier(.2,.8,.2,1)'});
  } catch (_) {}
}
function celebrate(card){
  // 工作日没课的“点我”：一串小猫爪从弹窗上方走过
  if (!S.running || !card || reduced()) return;
  const hw = .5*innerWidth/innerHeight;
  document.body.classList.add('xk-celebrate');
  later(() => document.body.classList.remove('xk-celebrate'), 3600);
  paws([-hw*.62, .0], [hw*.5, .44]);
  wake();
}
// 实验模式点开课程：从这张卡发出电信号，连到屏幕上同一门课的其他时段
function course(card){
  if (!S.running || !card || reduced()) return;
  const name = card.dataset.courseName, m = centerOf(card), a = field(m.x, m.y);
  ripple(m.x, m.y, 1); zap(card, 600);
  const others = targets().filter(el => el !== card && el.dataset.courseName === name).slice(0, 8);
  if (!others.length) return;
  const dur = DUR.links;
  if (!begin('neural', {dur, role:'links'})) return;
  U.edges.fill(0); U.edgeT.fill(0);
  others.forEach((el, i) => {
    const n = centerOf(el), b = field(n.x, n.y), len = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const start = .05 + i*.08, d = .14 + len*.8;
    U.edges.set([a[0], a[1], b[0], b[1]], i*4); U.edgeT.set([start/dur, d/dur], i*2);
    later(() => zap(el, 700), (start + d)*1000);
  });
  U.edgeN = others.length;
}
function panel(){}
function wakeFor(){ wake(); }
function openConsole(trigger){
  const grid = document.createElement('div'); grid.className = 'optical-console';
  const actions = [
    ['warp','01','曲速跃迁','开场重播：吞噬、爆闪、课程从隧道飞回'],
    ['ignite','02','显微启明','光圈调焦，课程依次浮现'],
    ['mitosis','03','细胞分裂','一个变两个，两个变四个'],
    ['neural','04','神经脉冲','电信号串起眼前每一门课'],
    ['ecg','05','心电扫描','一条心电图扫过暗场'],
    ['singularity','06','引力奇点','课程被黑洞吞下，再从水晶里结晶回来']
  ];
  for (const [action, index, title, detail] of actions){
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'optical-action' + (action === 'warp' ? ' optical-featured' : ''); b.dataset.fx = action;
    const n = document.createElement('span'), t = document.createElement('strong'), d = document.createElement('small');
    n.textContent = index; t.textContent = title; d.textContent = detail; b.append(n, t, d);
    b.onclick = () => { host()?.closeDialog(false); setTimeout(() => play(action), 60); };
    grid.append(b);
  }
  const hint = document.createElement('p'); hint.className = 'xk-hint';
  hint.textContent = '暗场里还藏着几个彩蛋：在空白处长按、连点、快速划一下试试。';
  grid.append(hint);
  const exit = document.createElement('button'); exit.type = 'button'; exit.className = 'optical-action optical-console-exit';
  exit.textContent = '退出实验模式'; exit.onclick = () => { host()?.closeDialog(false); host()?.exit(); };
  grid.append(exit);
  host()?.openDialog({title:'实验控制台', body:grid, kind:'showcase-console', closeLabel:'继续查看课表', trigger});
}

// 仅在网址带 ?xkdebug 时暴露，用于逐帧截图检查
if (/[?&]xkdebug/.test(location.search)) window.__xk = {S, U, render, clock, entry, skipEntry, PT};
window.ScheduleShowcaseEngine = {mount, sync, resize, playStartup, play, openConsole, wake:wakeFor, pause, resume, setModal, beginExit, destroy,
  qualityChanged, portal, portalLanding, travel, view, panel, motionChanged, today, oracle, celebrate, course, stop, isRunning:() => S.running,
  skipEntry:() => skipEntry(innerWidth/2, innerHeight/2), holePoint, isLocked:() => S.lock,
  PORTAL_SWAP, PORTAL_PULL, PORTAL_LAND, PORTAL_END};
})();
