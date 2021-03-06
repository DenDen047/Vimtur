import Ajv from 'ajv';
import Args from 'args';
import BetterAjvErrors from 'better-ajv-errors';
import DeepMerge from 'deepmerge';
import FS from 'fs';
import Path from 'path';
import PathIsInside from 'path-is-inside';
import StripJsonComments from 'strip-json-comments';

import { Configuration } from './types';

Args.option('config', 'The config file to to overlay')
  .option('file', 'The json file to import or export to')
  .option('stdin', 'Use this option to read the JSON file from stdin');

function mapEnv(env: string, obj: Record<string, any>, dest: string): void {
  if (process.env[env]) {
    console.log(`Using ${process.env[env]!} from ${env}`);
    let node = obj;
    const path = dest.split('.');
    for (let i = 0; i < path.length - 1; i++) {
      if (!node[path[i]]) {
        node[path[i]] = {};
      }
      node = node[path[i]];
    }

    let value: string | number = process.env[env]!;
    if (!isNaN(Number(value))) {
      value = Number(value);
    }
    node[path[path.length - 1]] = value;
  }
}

function readJsonSync(file: string): Configuration.Main {
  return JSON.parse(StripJsonComments(FS.readFileSync(file).toString()));
}

const DEFAULTS: any = {
  port: 3523,
  enablePhash: true,
  transcoder: {
    // Copy data to speedup setup.
    maxCopyEnabled: true,
    // Anything 480p or below loads quite quickly. So don't bother downscaling if the source is less.
    minQuality: 480,
    // Transcode to a small mobile quality and up to 1080p.
    // If the source is 720p it will transcode to 240p and 1080p
    qualities: [240, 480, 720, 1080],
    // Enables caching keyframes when they're initially accessed.
    enableCachingKeyframes: true,
    // Makes the first load of each video slower but initial import much faster.
    enablePrecachingKeyframes: false,
    // Disables caching during import of new media. Still allows using
    // the cache of existing media.
    enableVideoCaching: false,
  },
  user: {
    autoplayEnabled: true,
    tagColumnCount: 1,
    // It does create a messy browser history so keep it optional.
    stateEnabled: false,
    // False because likely local high-speed access.
    lowQualityOnLoadEnabled: false,
    // True because it may be over slower WiFi.
    lowQualityOnLoadEnabledForMobile: true,
    // Limit to loading 1000 items on initial UI load.
    initialLoadLimit: 1000,
  },
};

class Config {
  private schema: object;
  private merged?: Configuration.Main;
  private baseLayers?: Configuration.Partial[];

  public static init(): Config {
    const schema = readJsonSync(`${__dirname}/config.schema.json`);
    // Load the constant layers, all of these together should validate.
    // They may be overwritten at runtime though.
    const userConfig = Config.getUserLayer();
    const environment = Config.getEnvironmentLayer();
    const config = new Config(schema);
    // Order matters, userConfig over-writes default and environment over-writes userConfig.
    config.setLayers([DEFAULTS, userConfig, environment]);

    return config;
  }

  private static getEnvironmentLayer(): Configuration.Main {
    const config: any = {};
    // General config
    mapEnv('PORT', config, 'port');
    mapEnv('DATA_PATH', config, 'libraryPath');
    mapEnv('CACHE_PATH', config, 'cachePath');
    mapEnv('USERNAME', config, 'username');
    mapEnv('PASSWORD', config, 'password');
    // Database mapping
    mapEnv('DATABASE', config, 'database.provider');
    // MongoDB database configuration options.
    mapEnv('DATABASE_URI', config, 'database.uri');
    mapEnv('DATABASE_DB', config, 'database.db');

    return config;
  }

  private static getUserLayer(): Configuration.Partial {
    const flags = Args.parse(process.argv);
    const path = flags.config || process.env['CONFIG_PATH'];
    if (!path) {
      // The user layer is optional.
      return {};
    }
    return readJsonSync(path);
  }

  private constructor(schema: object) {
    this.schema = schema;
  }

  public get(): Configuration.Main {
    if (!this.merged) {
      throw new Error('Configuration layers incorrectly configured');
    }
    return this.merged;
  }

  public setUserOverlay(config: Configuration.Partial): void {
    this.setLayers([config]);
  }

  private setLayers(layers: Configuration.Partial[]): void {
    const layerArray: Configuration.Partial[] = [];
    if (this.baseLayers) {
      layerArray.push(...this.baseLayers);
    }
    layerArray.push(...layers);

    const merged: Configuration.Main = DeepMerge.all(layerArray) as any;
    // Remove duplicate items in the qualities array.
    merged.transcoder.qualities = [...new Set(merged.transcoder.qualities)].sort((a, b) => a - b);
    const schemaValidate = Ajv().compile(this.schema);
    if (!schemaValidate(merged)) {
      console.error(
        BetterAjvErrors(this.schema, merged, schemaValidate.errors),
        schemaValidate.errors,
      );
      throw new Error('Merged configuration schema failed to validate.');
    }
    // On the first call store the layers as the write-once base layers.
    if (!this.baseLayers) {
      // Some additional validation.
      if (PathIsInside(Path.resolve(merged.cachePath), Path.resolve(merged.libraryPath))) {
        throw new Error('Cache folder cannot be inside the library');
      }
      this.baseLayers = layers;
    }
    // Otherwise don't store the layers because they're stored in the database.
    this.merged = merged;
  }
}

export default Config.init();
