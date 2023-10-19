/* Autogenerated file. Do not edit manually. */

import { defineComponent, Type as RecsType, World } from "@latticexyz/recs";

export function defineContractComponents(world: World) {
  return {
    Moves: (() => {
      const name = "Moves";
      return defineComponent(
        world,
        {
          remaining: RecsType.Number,
          last_direction: RecsType.Number,
        },
        {
          metadata: {
            name: name,
            types: ["u8", "Direction"],
          },
        }
      );
    })(),
    Position: (() => {
      const name = "Position";
      return defineComponent(
        world,
        {
          x: RecsType.Number,
          y: RecsType.Number
        },
        {
          metadata: {
            name: name,
            types: ["Vec2"],
          },
        }
      );
    })(),
  };
}
