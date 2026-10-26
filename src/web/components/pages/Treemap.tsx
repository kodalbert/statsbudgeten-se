import { colorOf, type Item, type Placed } from "@/model";
import { SmallRow } from "@/components/chart/SmallRow";
import { Tile } from "@/components/chart/Tile";
import type { Info } from "@/components/info";

/** The map never gets shorter than this, and leaves this much room under itself for the list of small items. */
export const MAP_MIN = 140;
export const LIST_PEEK = 120;

export type TreemapProps = {
  placed: Placed<Item>[];
  listed: Item[];
  W: number;
  mapRoom: number;
  mapH: number;
  drilled: boolean;
  focusedKey: string | null;
  hoverTitle?: string;
  infoOf: (it: Item) => { info: Info; share: string };
  onHover: (info: Info | null) => void;
  onActivate: (it: Item) => void;
};

export function Treemap({ placed, listed, W, mapRoom, mapH, drilled, focusedKey, hoverTitle, infoOf, onHover, onActivate }: TreemapProps) {
  return (
    <>
      <div className="map" style={{ height: mapH }}>
        {placed.map(({ it, x, y, w, h }) => {
          const { bg, fg } = colorOf(it, drilled);
          const { info, share } = infoOf(it);
          return (
            <Tile
              key={it.key}
              it={it}
              rect={{
                left: `${(x / W) * 100}%`,
                top: `${(y / mapRoom) * 100}%`,
                width: `${(w / W) * 100}%`,
                height: `${(h / mapRoom) * 100}%`,
              }}
              w={w}
              h={(h * mapH) / mapRoom}
              bg={bg}
              fg={fg}
              share={share}
              info={info}
              hovered={hoverTitle === info.title}
              focused={focusedKey === it.key}
              onHover={onHover}
              onActivate={() => onActivate(it)}
            />
          );
        })}
      </div>
      {listed.length > 0 && (
        <ul className="small" aria-label="Poster som är för små att visa som block">
          {listed.map((it) => {
            const { bg } = colorOf(it, drilled);
            const { info, share } = infoOf(it);
            return (
              <SmallRow
                key={it.key}
                it={it}
                bg={bg}
                share={share}
                info={info}
                hovered={hoverTitle === info.title}
                focused={focusedKey === it.key}
                onHover={onHover}
                onActivate={() => onActivate(it)}
              />
            );
          })}
        </ul>
      )}
    </>
  );
}
