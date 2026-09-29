-- Rivo V2: six premium animated full-profile frames
-- Safe for an existing Rivo database. Existing store items are preserved.

insert into public.store_items (name, description, type, price, image_url, is_active)
select v.name, v.description, 'frame', v.price, null, true
from (values
  ('Frame · Meteorfall', 'Premium animated profile frame with diagonal meteor rain.', 4500::bigint),
  ('Frame · Starfall', 'Premium animated profile frame with descending star field.', 5200::bigint),
  ('Frame · Comettrail', 'Premium animated profile frame with moving comet trails.', 6000::bigint),
  ('Frame · Celestialveil', 'Premium animated profile frame with a rotating celestial veil.', 7000::bigint),
  ('Frame · Nebulabloom', 'Premium animated profile frame with a living nebula glow.', 8000::bigint),
  ('Frame · Nightshards', 'Premium animated profile frame with falling light shards.', 9000::bigint)
) as v(name, description, price)
where not exists (
  select 1 from public.store_items s
  where lower(s.name)=lower(v.name) and s.type='frame'
);

notify pgrst, 'reload schema';
