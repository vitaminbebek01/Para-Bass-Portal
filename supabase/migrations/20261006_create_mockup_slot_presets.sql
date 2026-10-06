-- Sahne, ürün ve maskelerden bağımsız tekrar kullanılabilir slot geometrileri.
create table if not exists public.mockup_slot_presets (
    id uuid primary key,
    name text not null check (char_length(trim(name)) between 1 and 120),
    slots jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 64),
    is_system boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

create index if not exists mockup_slot_presets_active_idx
    on public.mockup_slot_presets(is_system desc, created_at asc) where deleted_at is null;

drop trigger if exists set_mockup_slot_preset_updated_at on public.mockup_slot_presets;
create trigger set_mockup_slot_preset_updated_at
before update on public.mockup_slot_presets
for each row execute function public.set_mockup_updated_at();

alter table public.mockup_slot_presets enable row level security;
revoke all on public.mockup_slot_presets from anon, authenticated;
grant all on public.mockup_slot_presets to service_role;

with preset_data(id, name, cols, rows, mode) as (values
    ('10000000-0000-4000-8000-000000000001'::uuid, '2×2 Düz Grid', 2, 2, 'flat'),
    ('10000000-0000-4000-8000-000000000002'::uuid, '3×3 Düz Grid', 3, 3, 'flat'),
    ('10000000-0000-4000-8000-000000000003'::uuid, '4×4 Düz Grid', 4, 4, 'flat'),
    ('10000000-0000-4000-8000-000000000004'::uuid, '2×2 Sola Açılı', 2, 2, 'left'),
    ('10000000-0000-4000-8000-000000000005'::uuid, '3×3 Sola Açılı', 3, 3, 'left'),
    ('10000000-0000-4000-8000-000000000006'::uuid, '2×2 Sağa Açılı', 2, 2, 'right'),
    ('10000000-0000-4000-8000-000000000007'::uuid, '3×3 Sağa Açılı', 3, 3, 'right')
), generated as (
    select id, name, jsonb_agg(jsonb_build_object(
        'order', (r * cols + c),
        'frame', jsonb_build_object(
            'x', 260 + c * (1480.0 / greatest(cols - 1, 1)),
            'y', 300 + r * (1400.0 / greatest(rows - 1, 1)),
            'width', case when cols = 2 then 620 when cols = 3 then 430 else 320 end,
            'height', case when cols = 2 then 620 when cols = 3 then 430 else 320 end,
            'rotation', case when mode = 'left' then -6 when mode = 'right' then 6 else 0 end,
            'perspective', jsonb_build_object(
                'enabled', mode <> 'flat',
                'corners', jsonb_build_array(
                    jsonb_build_object('x', 260 + c * (1480.0 / greatest(cols - 1, 1)) - (case when cols = 2 then 310 when cols = 3 then 215 else 160 end), 'y', 300 + r * (1400.0 / greatest(rows - 1, 1)) - (case when cols = 2 then 270 when cols = 3 then 185 else 140 end)),
                    jsonb_build_object('x', 260 + c * (1480.0 / greatest(cols - 1, 1)) + (case when cols = 2 then 310 when cols = 3 then 215 else 160 end), 'y', 300 + r * (1400.0 / greatest(rows - 1, 1)) - (case when cols = 2 then 310 when cols = 3 then 215 else 160 end)),
                    jsonb_build_object('x', 260 + c * (1480.0 / greatest(cols - 1, 1)) + (case when cols = 2 then 310 when cols = 3 then 215 else 160 end), 'y', 300 + r * (1400.0 / greatest(rows - 1, 1)) + (case when cols = 2 then 310 when cols = 3 then 215 else 160 end)),
                    jsonb_build_object('x', 260 + c * (1480.0 / greatest(cols - 1, 1)) - (case when cols = 2 then 310 when cols = 3 then 215 else 160 end), 'y', 300 + r * (1400.0 / greatest(rows - 1, 1)) + (case when cols = 2 then 270 when cols = 3 then 185 else 140 end))
                )
            )
        )
    ) order by r, c) slots
    from preset_data cross join lateral generate_series(0, rows - 1) r cross join lateral generate_series(0, cols - 1) c
    group by id, name
), fixed(id, name, slots) as (values
    ('10000000-0000-4000-8000-000000000008'::uuid, 'Tek Büyük Hero Slot', '[{"order":0,"frame":{"x":1000,"y":1000,"width":1250,"height":1250,"rotation":0}}]'::jsonb),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'Hero + Arkada Küçük Ürünler', '[{"order":0,"frame":{"x":400,"y":720,"width":470,"height":470,"rotation":-10}},{"order":1,"frame":{"x":1600,"y":720,"width":470,"height":470,"rotation":10}},{"order":2,"frame":{"x":1000,"y":1120,"width":1050,"height":1050,"rotation":0}}]'::jsonb)
), all_presets as (
    select id, name, slots from generated union all select id, name, slots from fixed
)
insert into public.mockup_slot_presets(id, name, slots, is_system)
select id, name, slots, true from all_presets
on conflict (id) do nothing;
