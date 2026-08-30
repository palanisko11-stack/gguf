// ============================================================================
//  TABULE.CPP  ·  3D tabule „Havířov" — samostatný C++17 raytracer
// ----------------------------------------------------------------------------
//  Stejna scena jako webova verze (Three.js), prelozena do cisteho C++
//  BEZ JEDINE EXTERNI KNIHOVNY (zadne OpenGL, SDL ani stb). Vystupem je
//  obrazek ve formatu PPM (P6), ktery otevre GIMP, IrfanView, ImageMagick...
//
//  Povrch tabule je vlnita vyskova plocha — ta vlni uplne stejnou funkci
//  jako v prohlizeci. Textura povrchu se nacte ze souboru havirov.ppm (P6),
//  pokud lezi vedle programu; jinak se vygeneruje proceduralni uhelny povrch.
//
//  PREKLAD  (Linux / macOS / WSL / MinGW):
//      g++ -O2 -std=c++17 tabule.cpp -o tabule
//  PREKLAD  (MSVC):
//      cl /O2 /std:c++17 /EHsc tabule.cpp
//
//  SPUSTENI:
//      ./tabule                  ->  tabule.ppm              (1 snimek)
//      ./tabule 90               ->  tabule_000..089.ppm     (animace, 90 fazi)
//      ./tabule 30 1280 800      ->  30 snimku ve vlastnim rozliseni
//
//  PREVOD TEXTURY Z WEBP:
//      ffmpeg -i havirov.webp havirov.ppm
//      (nebo: magick havirov.webp havirov.ppm)
//
//  VIDEO Z ANIMACE:
//      ffmpeg -framerate 30 -i tabule_%03d.ppm -pix_fmt yuv420p tabule.mp4
// ============================================================================

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#include <algorithm>

// ---------------------------------------------------------------------------
//  Vektorova matematika
// ---------------------------------------------------------------------------
struct V3 {
    double x = 0, y = 0, z = 0;
    V3() {}
    V3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
    V3 operator+(const V3& o) const { return V3(x + o.x, y + o.y, z + o.z); }
    V3 operator-(const V3& o) const { return V3(x - o.x, y - o.y, z - o.z); }
    V3 operator*(double s)    const { return V3(x * s, y * s, z * s); }
    V3 operator*(const V3& o) const { return V3(x * o.x, y * o.y, z * o.z); }
    V3 operator/(double s)    const { return V3(x / s, y / s, z / s); }
};
static V3 operator*(double s, const V3& v) { return v * s; }

static double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static V3 cross(const V3& a, const V3& b) {
    return V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
static double vlen(const V3& v) { return std::sqrt(dot(v, v)); }
static V3 vnorm(const V3& v) { double l = vlen(v); return l > 1e-12 ? v / l : V3(0, 0, 0); }

// ---------------------------------------------------------------------------
//  Parametry sceny (shodne s webovou verzi)
// ---------------------------------------------------------------------------
static const double BOARD_H = 4.0;   // vyska tabule [m]
static const double BOARD_Y = 2.9;   // vyska stredu tabule nad podlahou
static double g_boardW = 6.4;        // sirka tabule (odvozena z pomeru textury)
static double g_amp    = 0.07;       // vyska vlneni povrchu
static double g_freq   = 1.25;       // prostorova frekvence vln
static double g_time   = 0.0;        // animacni faze

// Vlnici funkce povrchu — identicka s Three.js verzi
static double wave(double x, double y) {
    double t = g_time;
    return std::sin(x * g_freq + t * 1.25) * 0.55 +
           std::sin(y * g_freq * 1.65 - t * 0.85) * 0.30 +
           std::sin((x + y) * g_freq * 0.62 + t * 0.60) * 0.15;
}

// ---------------------------------------------------------------------------
//  SDF geometrie (sphere tracing)
// ---------------------------------------------------------------------------
static double sdBox(V3 p, V3 b) {
    V3 q(std::fabs(p.x) - b.x, std::fabs(p.y) - b.y, std::fabs(p.z) - b.z);
    double ox = std::max(q.x, 0.0), oy = std::max(q.y, 0.0), oz = std::max(q.z, 0.0);
    double outside = std::sqrt(ox * ox + oy * oy + oz * oz);
    double inside  = std::min(std::max(q.x, std::max(q.y, q.z)), 0.0);
    return outside + inside;
}

struct Hit { double d; int id; };

// materialy: 0 podlaha · 1 povrch tabule · 2 tmava ocel · 3 ram · 4 lampa
static Hit sceneMap(V3 p) {
    double w2 = g_boardW * 0.5, h2 = BOARD_H * 0.5;
    double best = p.y; int id = 0;                          // podlaha (rovina y=0)

    // telo tabule: kvadr, jehoz predni stena je vlnita plocha
    V3 q(p.x, p.y - BOARD_Y, p.z);
    double boxD  = sdBox(q, V3(w2, h2, 0.14));
    double front = q.z - (0.14 + g_amp * wave(q.x, q.y));   // vzdalenost k vlne
    double d = std::max(boxD, front);
    if (d < best) { best = d; id = 1; }

    // ram — ctyri listy kolem panelu
    const double t2 = 0.12, fd = 0.13;
    d = sdBox(q - V3(0,  (h2 + t2), -0.02), V3(w2 + 2.0 * t2, t2, fd));
    if (d < best) { best = d; id = 3; }
    d = sdBox(q - V3(0, -(h2 + t2), -0.02), V3(w2 + 2.0 * t2, t2, fd));
    if (d < best) { best = d; id = 3; }
    d = sdBox(q - V3( (w2 + t2), 0, -0.02), V3(t2, h2, fd));
    if (d < best) { best = d; id = 3; }
    d = sdBox(q - V3(-(w2 + t2), 0, -0.02), V3(t2, h2, fd));
    if (d < best) { best = d; id = 3; }

    // zadni deska, nohy, paticky, travnik — tmava ocel
    d = sdBox(q - V3(0, 0, -0.08), V3(w2 + 0.02, h2 + 0.02, 0.08));
    if (d < best) { best = d; id = 2; }
    double legX = g_boardW * 0.33;
    d = sdBox(p - V3( legX, 0.27, -0.19), V3(0.075, 0.39, 0.075));
    if (d < best) { best = d; id = 2; }
    d = sdBox(p - V3(-legX, 0.27, -0.19), V3(0.075, 0.39, 0.075));
    if (d < best) { best = d; id = 2; }
    d = sdBox(p - V3( legX, 0.03, -0.19), V3(0.26, 0.03, 0.17));
    if (d < best) { best = d; id = 2; }
    d = sdBox(p - V3(-legX, 0.03, -0.19), V3(0.26, 0.03, 0.17));
    if (d < best) { best = d; id = 2; }
    d = sdBox(p - V3(0, 0.24, -0.19), V3(legX + 0.075, 0.045, 0.06));
    if (d < best) { best = d; id = 2; }

    // svetelna lista pod ramem — dulni lampa
    d = sdBox(p - V3(0, 0.57, 0.14), V3(g_boardW * 0.41, 0.025, 0.025));
    if (d < best) { best = d; id = 4; }

    Hit h; h.d = best; h.id = id;
    return h;
}

static V3 sceneNormal(V3 p) {
    const double e = 0.002;
    double d0 = sceneMap(p).d;
    return vnorm(V3(sceneMap(p + V3(e, 0, 0)).d - d0,
                    sceneMap(p + V3(0, e, 0)).d - d0,
                    sceneMap(p + V3(0, 0, e)).d - d0));
}

static Hit rayMarch(V3 ro, V3 rd, double& tOut) {
    double t = 0.02;
    for (int i = 0; i < 160; ++i) {
        Hit h = sceneMap(ro + rd * t);
        if (h.d < 0.0012) { tOut = t; return h; }
        t += h.d * 0.85;
        if (t > 60.0) break;
    }
    tOut = -1.0;
    Hit miss; miss.d = -1.0; miss.id = -1;
    return miss;
}

static double shadowMarch(V3 p, V3 L) {
    double t = 0.03;
    for (int i = 0; i < 40; ++i) {
        double d = sceneMap(p + L * t).d;
        if (d < 0.0015) return 0.0;
        t += std::max(d * 0.9, 0.02);
        if (t > 25.0) break;
    }
    return 1.0;
}

static double ambientOcclusion(V3 p, V3 n) {
    double occ = 0.0, sca = 1.0;
    for (int i = 1; i <= 5; ++i) {
        double hstep = 0.03 * i;
        occ += (hstep - sceneMap(p + n * hstep).d) * sca;
        sca *= 0.72;
    }
    return std::max(0.0, 1.0 - 1.6 * occ);
}

// ---------------------------------------------------------------------------
//  Textury: havirov.ppm (P6), jinak proceduralni uhli
// ---------------------------------------------------------------------------
struct Image { int w = 0, h = 0; std::vector<uint8_t> px; };
static Image g_tex;

static bool loadPPM(const std::string& path, Image& img) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    char magic[3] = {0, 0, 0};
    int w = 0, h = 0, maxv = 0;
    if (std::fscanf(f, "%2s", magic) != 1 || std::string(magic) != "P6" ||
        std::fscanf(f, "%d %d %d", &w, &h, &maxv) != 3 ||
        w < 1 || h < 1 || maxv <= 0 || maxv > 255) {
        std::fclose(f);
        return false;
    }
    std::fgetc(f); // jediny bil znak za hlavickou
    img.w = w; img.h = h;
    img.px.resize((size_t)w * (size_t)h * 3);
    size_t got = std::fread(img.px.data(), 1, img.px.size(), f);
    std::fclose(f);
    return got == img.px.size();
}

static double hash2(double x, double y) {
    double s = std::sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - std::floor(s);
}
static double vnoise(double x, double y) {
    double xi = std::floor(x), yi = std::floor(y);
    double xf = x - xi, yf = y - yi;
    double u = xf * xf * (3.0 - 2.0 * xf);
    double v = yf * yf * (3.0 - 2.0 * yf);
    double a = hash2(xi, yi),     b = hash2(xi + 1, yi);
    double c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
static double fbm(double x, double y) {
    double s = 0.0, amp = 0.5, f = 1.0;
    for (int i = 0; i < 5; ++i) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return s;
}
static double smooth01(double x) {
    double c = std::min(std::max(x, 0.0), 1.0);
    return c * c * (3.0 - 2.0 * c);
}

// zalozni povrch: vrstevnate uhli s jantarovymi zilami a sparami panelu
static V3 proceduralCoal(double u, double v) {
    double n      = fbm(u * 6.0, v * 6.0);
    double strata = fbm(u * 3.0 + 11.7, v * 14.0);
    double veins  = std::pow(std::max(0.0,
        1.0 - std::fabs(fbm(u * 5.0 + 3.1, v * 5.0 - 2.2) - 0.5) * 4.0), 3.0);
    double base = 0.10 + 0.16 * n + 0.06 * strata;
    V3 col(base, base * 0.96, base * 0.92);
    col = col + V3(0.95, 0.62, 0.22) * (veins * 0.55);
    double gx = std::fabs(std::fmod(u * 4.0 + 0.5, 1.0) - 0.5);
    double gy = std::fabs(std::fmod(v * 2.5 + 0.5, 1.0) - 0.5);
    col = col * (0.55 + 0.45 * smooth01(std::min(gx, gy) * 24.0));
    double edge = std::min(std::min(u, 1.0 - u), std::min(v, 1.0 - v));
    col = col * (0.72 + 0.28 * smooth01(edge * 8.0));
    return col;
}

static V3 sampleTex(double u, double v) {
    if (g_tex.w > 0 && g_tex.h > 0) {
        u = u - std::floor(u);
        v = v - std::floor(v);
        int x = (int)(u * g_tex.w);
        x = std::min(std::max(x, 0), g_tex.w - 1);
        int y = (int)((1.0 - v) * g_tex.h);
        y = std::min(std::max(y, 0), g_tex.h - 1);
        const uint8_t* p = &g_tex.px[((size_t)y * (size_t)g_tex.w + (size_t)x) * 3];
        return V3(p[0] / 255.0, p[1] / 255.0, p[2] / 255.0);
    }
    return proceduralCoal(u, v);
}

// ---------------------------------------------------------------------------
//  Svetla a stinovani
// ---------------------------------------------------------------------------
static V3 background(V3 rd) {
    double h = std::max(rd.y * 0.5 + 0.5, 0.0);
    V3 col = V3(0.052, 0.042, 0.038) * h + V3(0.016, 0.012, 0.011) * (1.0 - h);
    double glow  = std::exp(-std::pow((rd.y - 0.08) * 4.5, 2.0));
    double behind = std::max(0.0, -rd.z);
    col = col + V3(0.30, 0.17, 0.06) * (glow * (0.25 + 0.75 * behind));
    double side = std::max(0.0, -rd.x);
    col = col + V3(0.05, 0.08, 0.11) * (glow * side);
    return col;
}

static V3 shade(V3 p, V3 rd, int id) {
    // emisni lampa — vraci se rovnou
    if (id == 4) {
        double fl = 0.85 + 0.15 * std::sin(g_time * 6.3) + 0.06 * std::sin(g_time * 17.7);
        return V3(3.0, 1.85, 0.70) * fl;
    }

    V3 n = sceneNormal(p);
    V3 q(p.x, p.y - BOARD_Y, p.z);
    double w2 = g_boardW * 0.5, h2 = BOARD_H * 0.5;

    V3 alb(0.13, 0.10, 0.085);   // podlaha
    double spec = 0.7, gloss = 46.0, metal = 0.55;
    V3 emis(0, 0, 0);

    if (id == 1) {
        double u = q.x / (2.0 * w2) + 0.5;
        double v = q.y / (2.0 * h2) + 0.5;
        alb = sampleTex(u, v);
        spec = 0.5; gloss = 42.0; metal = 0.14;
    } else if (id == 3) {
        alb = V3(0.16, 0.135, 0.12);
        spec = 1.0; gloss = 60.0; metal = 1.0;
    } else if (id == 2) {
        alb = V3(0.11, 0.095, 0.085);
        spec = 0.6; gloss = 30.0; metal = 0.7;
    } else {
        // podlaha: podium + jantarovy kruh
        double r = std::sqrt(p.x * p.x + p.z * p.z);
        if (r < 5.4) alb = alb * 1.28;
        if (std::fabs(r - 5.46) < 0.06) emis = V3(0.55, 0.34, 0.11) * 0.22;
    }

    double ao = ambientOcclusion(p, n);

    V3 L1 = vnorm(V3(4.6, 6.4, 5.2));                // teple klicove svetlo
    V3 C1(1.0, 0.83, 0.60);  double I1 = 2.6;
    V3 L2 = vnorm(V3(-6.5, 4.6, -5.0));              // studene obrysove svetlo
    V3 C2(0.38, 0.55, 0.72); double I2 = 1.5;
    V3 lampPos(0.0, 0.72, 1.1);                      // dulni lampa
    V3 C3(0.95, 0.60, 0.23);

    double sh   = shadowMarch(p + n * 0.012, L1);
    double dif1 = std::max(dot(n, L1), 0.0) * sh * I1;
    double dif2 = std::max(dot(n, L2), 0.0) * I2;

    V3  toLamp = lampPos - p;
    double dL  = vlen(toLamp);
    toLamp = toLamp / dL;
    double dif3 = std::max(dot(n, toLamp), 0.0) * 6.0 / (1.0 + 0.5 * dL * dL);

    V3 H1 = vnorm(L1 - rd);
    V3 H3 = vnorm(toLamp - rd);
    double sp = std::pow(std::max(dot(n, H1), 0.0), gloss) * spec * sh * I1 * 0.5 +
                std::pow(std::max(dot(n, H3), 0.0), gloss) * spec * dif3 * 0.6;

    V3 amb   = V3(0.16, 0.13, 0.11) * ((0.55 + 0.45 * std::max(n.y, 0.0)) * ao);
    V3 spCol = alb * metal + V3(0.25, 0.24, 0.22) * (1.0 - metal);

    return alb * (C1 * dif1 + C2 * dif2 + C3 * dif3 + amb) + spCol * sp + emis;
}

// ACES tonemap (aproximace Narkowicz) + gamma
static double acesCh(double v) {
    v = std::max(v, 0.0);
    return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
}
static uint8_t tonemap(double c) {
    double v = std::pow(std::min(std::max(acesCh(c * 1.12), 0.0), 1.0), 1.0 / 2.2);
    return (uint8_t)(255.99 * v);
}

// ---------------------------------------------------------------------------
//  Prach — 2D projekce castic do hotoveho obrazku (aditivni)
// ---------------------------------------------------------------------------
static uint8_t add8(uint8_t a, double b) {
    double s = (double)a + b;
    return (uint8_t)(s > 255.0 ? 255.0 : s);
}
static void dustOverlay(std::vector<uint8_t>& buf, int W, int H,
                        V3 ro, V3 right, V3 up, V3 fwd, double fl, double timeAnim) {
    const int N = 110;
    for (int i = 0; i < N; ++i) {
        double bx = (hash2((double)i, 7.3) - 0.5) * 19.0;
        double bz = (hash2((double)i, 3.1) - 0.5) * 13.0;
        double vy = 0.06 + 0.22 * hash2((double)i, 9.7);
        double y  = std::fmod(hash2((double)i, 5.9) * 7.5 + timeAnim * vy * 4.0, 7.5);
        V3 p(bx + std::sin(timeAnim * 0.35 + (double)i) * 0.5, y, bz);
        V3 rel = p - ro;
        double zc = dot(rel, fwd);
        if (zc < 0.3) continue;
        double sx = (dot(rel, right) * fl / zc) * (W * 0.5) + W * 0.5;
        double sy = H * 0.5 - (dot(rel, up) * fl / zc) * (H * 0.5);
        double depthFall = std::min(1.0, 3.0 / zc);
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                int ix = (int)sx + dx, iy = (int)sy + dy;
                if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
                double fall = ((dx == 0 && dy == 0) ? 0.5 : 0.16) * depthFall;
                size_t o = ((size_t)iy * (size_t)W + (size_t)ix) * 3;
                buf[o]     = add8(buf[o],     244.0 * fall);
                buf[o + 1] = add8(buf[o + 1], 195.0 * fall);
                buf[o + 2] = add8(buf[o + 2], 122.0 * fall);
            }
        }
    }
}

// ---------------------------------------------------------------------------
//  Render jednoho snimku
// ---------------------------------------------------------------------------
static bool writePPM(const std::string& path, int W, int H, const std::vector<uint8_t>& buf) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    std::fprintf(f, "P6\n%d %d\n255\n", W, H);
    bool ok = std::fwrite(buf.data(), 1, buf.size(), f) == buf.size();
    std::fclose(f);
    return ok;
}

static bool renderFrame(int W, int H, double timeAnim, const std::string& path) {
    g_time = timeAnim;

    // kamera — mirny oblet sceny
    double az   = 0.55 + 0.10 * std::sin(timeAnim * 0.25);
    double pol  = 1.22;
    double dist = 9.6;
    V3 target(0, 2.65, 0);
    V3 ro(target.x + dist * std::sin(pol) * std::sin(az),
          target.y + dist * std::cos(pol),
          target.z + dist * std::sin(pol) * std::cos(az));
    V3 fwd   = vnorm(target - ro);
    V3 right = vnorm(cross(fwd, V3(0, 1, 0)));
    V3 up    = cross(right, fwd);
    double fl = 1.9; // ohnisko ~40°

    std::vector<uint8_t> buf((size_t)W * (size_t)H * 3);
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            double u = (2.0 * (x + 0.5) / W - 1.0) * (double)W / (double)H;
            double v = 1.0 - 2.0 * (y + 0.5) / H;
            V3 rd = vnorm(fwd * fl + right * u + up * v);
            double t = 0.0;
            Hit h = rayMarch(ro, rd, t);
            V3 col;
            if (h.id >= 0) {
                V3 p = ro + rd * t;
                col = shade(p, rd, h.id);
                double fog = 1.0 - std::exp(-t * 0.042);
                col = col * (1.0 - fog) + background(rd) * fog;
            } else {
                col = background(rd);
            }
            size_t o = ((size_t)y * (size_t)W + (size_t)x) * 3;
            buf[o]     = tonemap(col.x);
            buf[o + 1] = tonemap(col.y);
            buf[o + 2] = tonemap(col.z);
        }
    }
    dustOverlay(buf, W, H, ro, right, up, fwd, fl, timeAnim);
    return writePPM(path, W, H, buf);
}

// ---------------------------------------------------------------------------
//  main
// ---------------------------------------------------------------------------
int main(int argc, char** argv) {
    int frames = 1, W = 960, H = 600;
    if (argc > 1) frames = std::max(1, std::atoi(argv[1]));
    if (argc > 3) {
        W = std::max(64, std::atoi(argv[2]));
        H = std::max(64, std::atoi(argv[3]));
    }

    if (loadPPM("havirov.ppm", g_tex)) {
        double aspect = (double)g_tex.w / (double)g_tex.h;
        g_boardW = std::min(9.6, std::max(3.2, BOARD_H * aspect));
        std::printf("[tabule] textura havirov.ppm (%dx%d) nactena — sirka tabule %.2f m\n",
                    g_tex.w, g_tex.h, g_boardW);
    } else {
        std::printf("[tabule] havirov.ppm nenalezen -> proceduralni uhelny povrch\n");
        std::printf("[tabule] tip: ffmpeg -i havirov.webp havirov.ppm\n");
    }

    std::printf("[tabule] render: %d snimek/snimku @ %dx%d (raymarching, CPU)\n", frames, W, H);
    for (int i = 0; i < frames; ++i) {
        double t = (frames > 1) ? (double)i / 30.0 : 2.4;
        char name[64];
        if (frames == 1) std::snprintf(name, sizeof(name), "tabule.ppm");
        else             std::snprintf(name, sizeof(name), "tabule_%03d.ppm", i);
        if (!renderFrame(W, H, t, name)) {
            std::printf("\n[tabule] CHYBA: nelze zapsat %s\n", name);
            return 1;
        }
        std::printf("\r[tabule] hotovo %d/%d", i + 1, frames);
        std::fflush(stdout);
    }
    std::printf("\n[tabule] dokonceno -> %s\n", frames == 1 ? "tabule.ppm" : "tabule_*.ppm");
    std::printf("[tabule] nahled:  display tabule.ppm   (ImageMagick) nebo otevrit v GIMPu\n");
    return 0;
}
