/** Hand-authored grid fixture: no user project data or artwork. */
export function grid43(
  cols?: number,
  rows?: number,
): {
  skeleton: {
    spine: string;
    width: number;
    height: number;
  };
  bones: (
    | {
        name: string;
        parent?: undefined;
        inherit?: undefined;
      }
    | {
        name: string;
        parent: string;
        inherit: string;
      }
  )[];
  slots: {
    name: string;
    bone: string;
    attachment: string;
  }[];
  skins: {
    name: string;
    attachments: {
      panel: {
        panel: {
          type: string;
          vertices: number[];
          uvs: number[];
          triangles: number[];
          hull: number;
        };
      };
    };
  }[];
  animations: {
    idle: {
      attachments: {
        default: {
          panel: {
            panel: {
              deform: (
                | {
                    time?: undefined;
                    offset?: undefined;
                    vertices?: undefined;
                  }
                | {
                    time: number;
                    offset: number;
                    vertices: number[];
                  }
                | {
                    time: number;
                    offset?: undefined;
                    vertices?: undefined;
                  }
              )[];
            };
          };
        };
      };
    };
    intro: {
      bones: {
        panel: {
          rotate: (
            | {
                value: number;
                time?: undefined;
              }
            | {
                time: number;
                value: number;
              }
            | {
                time: number;
                value?: undefined;
              }
          )[];
          scale: (
            | {
                x: number;
                y: number;
                time?: undefined;
              }
            | {
                time: number;
                x: number;
                y: number;
              }
            | {
                time: number;
                x?: undefined;
                y?: undefined;
              }
          )[];
        };
      };
    };
  };
};
