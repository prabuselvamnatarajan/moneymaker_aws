import { config as strategyChooserConfig } from './Init/strategyChooser_Live.js';
import { main as baseInitMain } from './Init/base_init.js';

baseInitMain(strategyChooserConfig).catch(console.error);
