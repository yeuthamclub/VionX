// Builds the curriculum tree from the flat node list of GET /admin/library/curriculum.

export interface FlatNode {
  id: string;
  parentId: string | null;
  code: string;
  sortOrder: number;
}

export type TreeNode<T extends FlatNode> = T & { children: TreeNode<T>[] };

/**
 * Nests nodes by `parentId`, siblings ordered by `sortOrder` then `code`. A node whose parent is
 * not in the list (e.g. an archived parent filtered out) becomes a root so nothing disappears.
 */
export function buildTree<T extends FlatNode>(nodes: readonly T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [] });
  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: FlatNode, b: FlatNode) =>
    a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
  const sort = (list: TreeNode<T>[]) => {
    list.sort(order);
    for (const child of list) sort(child.children);
  };
  sort(roots);
  return roots;
}

/** Ids of every node that has children (to expand or collapse all). */
export function branchIds<T extends FlatNode>(roots: readonly TreeNode<T>[]): string[] {
  return roots.flatMap((node) =>
    node.children.length > 0 ? [node.id, ...branchIds(node.children)] : [],
  );
}
