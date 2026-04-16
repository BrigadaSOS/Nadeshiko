function getPathOrder(pathItem) {
  if (!pathItem || typeof pathItem !== 'object') return Number.POSITIVE_INFINITY;
  if (typeof pathItem['x-order'] === 'number') return pathItem['x-order'];

  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
  let min = Number.POSITIVE_INFINITY;
  for (const method of methods) {
    const op = pathItem[method];
    if (op && typeof op['x-order'] === 'number' && op['x-order'] < min) {
      min = op['x-order'];
    }
  }
  return min;
}

function SortPathsByXOrder() {
  return {
    Paths: {
      leave(paths) {
        const keys = Object.keys(paths);
        keys.sort((a, b) => getPathOrder(paths[a]) - getPathOrder(paths[b]));

        const ordered = {};
        for (const key of keys) ordered[key] = paths[key];
        for (const key of Object.keys(paths)) delete paths[key];
        Object.assign(paths, ordered);
      },
    },
  };
}

export default function NadeshikoPlugin() {
  return {
    id: 'nadeshiko',
    decorators: {
      oas3: {
        'sort-paths-by-x-order': SortPathsByXOrder,
      },
    },
  };
}
