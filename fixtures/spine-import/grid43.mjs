/** Hand-authored grid fixture: no user project data or artwork. */
export function grid43(cols = 28, rows = 36) {
  const vertices = [],
    uvs = [],
    triangles = [];
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= cols; x++) {
      vertices.push(-110 + (x * 220) / cols, 165 - (y * 330) / rows);
      uvs.push(x / cols, y / rows);
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const a = y * (cols + 1) + x,
        b = a + cols + 1;
      triangles.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const middle = Math.floor(vertices.length / 4);
  return {
    skeleton: { spine: '4.3.26', width: 220, height: 330 },
    bones: [{ name: 'root' }, { name: 'panel', parent: 'root', inherit: 'Normal' }],
    slots: [{ name: 'panel', bone: 'panel', attachment: 'panel' }],
    skins: [
      {
        name: 'default',
        attachments: {
          panel: { panel: { type: 'mesh', vertices, uvs, triangles, hull: vertices.length / 2 } },
        },
      },
    ],
    animations: {
      idle: {
        attachments: {
          default: {
            panel: {
              panel: {
                deform: [{}, { time: 1, offset: middle * 2 + 1, vertices: [15, 18, -12] }, { time: 2 }],
              },
            },
          },
        },
      },
      intro: {
        bones: {
          panel: {
            rotate: [{ value: -8 }, { time: 0.3, value: 5 }, { time: 0.6 }],
            scale: [{ x: 0.8, y: 0.8 }, { time: 0.3, x: 1.1, y: 1.1 }, { time: 0.6 }],
          },
        },
      },
    },
  };
}
