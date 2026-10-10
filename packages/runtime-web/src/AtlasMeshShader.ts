import {
  Shader,
  Texture,
  compileHighShaderGlProgram,
  compileHighShaderGpuProgram,
  localUniformBit,
  localUniformBitGl,
  roundPixelsBit,
  roundPixelsBitGl,
  type GlProgram,
  type GpuProgram,
} from 'pixi.js';

let glProgram: GlProgram | undefined, gpuProgram: GpuProgram | undefined;
const textureUniforms = `struct TextureUniforms { uTextureMatrix:mat3x3<f32>, uClampFrame:vec4<f32>, }
@group(2) @binding(2) var<uniform> textureUniforms : TextureUniforms;`;

/** Preserve source clamp-to-edge semantics when authored mesh UVs extend outside an atlas region. */
export class AtlasMeshShader extends Shader {
  private current: Texture;
  constructor(texture: Texture) {
    glProgram ??= compileHighShaderGlProgram({
      name: 'native-atlas-clamp',
      bits: [
        localUniformBitGl,
        {
          name: 'atlas-texture',
          vertex: {
            header: 'uniform mat3 uTextureMatrix;',
            main: 'uv = (uTextureMatrix * vec3(uv, 1.0)).xy;',
          },
          fragment: {
            header: 'uniform sampler2D uTexture; uniform vec4 uClampFrame;',
            main: 'outColor = texture(uTexture, clamp(vUV, uClampFrame.xy, uClampFrame.zw));',
          },
        },
        roundPixelsBitGl,
      ],
    });
    gpuProgram ??= compileHighShaderGpuProgram({
      name: 'native-atlas-clamp',
      bits: [
        localUniformBit,
        {
          name: 'atlas-texture',
          vertex: {
            header: textureUniforms,
            main: 'uv = (textureUniforms.uTextureMatrix * vec3(uv, 1.0)).xy;',
          },
          fragment: {
            header: `${textureUniforms}\n@group(2) @binding(0) var uTexture: texture_2d<f32>;\n@group(2) @binding(1) var uSampler: sampler;`,
            main: 'outColor = textureSample(uTexture, uSampler, clamp(vUV, textureUniforms.uClampFrame.xy, textureUniforms.uClampFrame.zw));',
          },
        },
        roundPixelsBit,
      ],
    });
    super({
      glProgram,
      gpuProgram,
      resources: {
        uTexture: texture.source,
        uSampler: texture.source.style,
        textureUniforms: {
          uTextureMatrix: { type: 'mat3x3<f32>', value: texture.textureMatrix.mapCoord },
          uClampFrame: { type: 'vec4<f32>', value: new Float32Array(4) },
        },
      },
    });
    this.current = texture;
    this.texture = texture;
  }
  get texture(): Texture {
    return this.current;
  }
  set texture(texture: Texture) {
    this.current = texture;
    this.resources.uTexture = texture.source;
    this.resources.uSampler = texture.source.style;
    this.resources.textureUniforms.uniforms.uTextureMatrix = texture.textureMatrix.mapCoord;
    const f = texture.frame,
      source = texture.source;
    const bounds = this.resources.textureUniforms.uniforms.uClampFrame as Float32Array;
    bounds.set([
      (f.x + 0.5) / source.width,
      (f.y + 0.5) / source.height,
      (f.x + f.width - 0.5) / source.width,
      (f.y + f.height - 0.5) / source.height,
    ]);
    this.resources.textureUniforms.update();
  }
}
