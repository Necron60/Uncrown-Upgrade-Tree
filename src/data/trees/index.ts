import type { TreeDef, TreeId } from '../tree';
import { BLOOM } from './bloom';
import { CROWN } from './crown';

export { BLOOM, CROWN };

export const TREES: Record<TreeId, TreeDef> = { bloom: BLOOM, crown: CROWN };
/** in the order they are reached */
export const TREE_ORDER: TreeId[] = ['bloom', 'crown'];
