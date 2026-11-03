import { Filter, GlProgram, Texture, TexturePool, type FilterSystem, type RenderSurface } from 'pixi.js';
import { vertex } from 'pixi-filters/defaults';
import { KawaseBlurFilter } from 'pixi-filters/kawase-blur';

const EXTRACT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uThreshold;
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  float b = (max(max(c.r, c.g), c.b) + min(min(c.r, c.g), c.b)) * 0.5;
  finalColor = b > uThreshold ? c : vec4(0.0);
}`;

const COMBINE = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uMapTexture;
uniform float uBloomScale;
uniform vec2 uMapScale;
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 glow = texture(uMapTexture, vTextureCoord * uMapScale).rgb * uBloomScale;
  finalColor = c + vec4(glow, 0.0);
}`;

export interface BloomOptions {
  threshold: number;
  bloomScale: number;
  blur: number;
  quality: number;
  /** resolution of the bright-pass and blur relative to the screen (the glow is soft, it needs no detail) */
  downscale?: number;
}

/**
 * Bloom whose expensive passes (bright-pass + Kawase blur) run at reduced resolution, while the
 * final combine stays at full resolution, so the scene stays sharp on HiDPI screens.
 * Same look as AdvancedBloomFilter at a fraction of the fill cost.
 */
export class HalfResBloom extends Filter {
  private extract: Filter;
  private blur: KawaseBlurFilter;
  private downscale: number;

  constructor(o: BloomOptions) {
    super({
      glProgram: GlProgram.from({ vertex, fragment: COMBINE, name: 'half-res-bloom' }),
      resources: {
        bloomUniforms: {
          uBloomScale: { value: o.bloomScale, type: 'f32' },
          uMapScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        },
        uMapTexture: Texture.WHITE.source,
      },
    });
    this.downscale = o.downscale ?? 0.5;
    this.extract = new Filter({
      glProgram: GlProgram.from({ vertex, fragment: EXTRACT, name: 'bloom-extract' }),
      resources: { extractUniforms: { uThreshold: { value: o.threshold, type: 'f32' } } },
    });
    // blur radius is in texels: scale it so the glow keeps the same on-screen size at reduced resolution
    this.blur = new KawaseBlurFilter({ strength: o.blur * this.downscale, quality: o.quality });
  }

  override apply(fm: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean) {
    const req = { width: input.frame.width, height: input.frame.height, resolution: input.source.resolution * this.downscale };
    const bright = TexturePool.getOptimalTexture(req);
    this.extract.apply(fm, input, bright, true);
    const glow = TexturePool.getOptimalTexture(req);
    this.blur.apply(fm, bright, glow, true);
    // the combine pass samples the glow with the *input's* texture coordinates; pooled textures can be
    // padded differently at different sizes, so map one coordinate space onto the other
    const s = this.resources.bloomUniforms.uniforms.uMapScale as Float32Array;
    s[0] = (glow.frame.width / glow.source.width) / (input.frame.width / input.source.width);
    s[1] = (glow.frame.height / glow.source.height) / (input.frame.height / input.source.height);
    this.resources.uMapTexture = glow.source;
    fm.applyFilter(this, input, output, clearMode);
    TexturePool.returnTexture(glow);
    TexturePool.returnTexture(bright);
  }
}
