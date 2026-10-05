-- Mockup Studio: Etsy ve mevcut AI tablolarından tamamen izole veri alanı.
-- Şablon ve çıktı silme işlemleri yalnızca deleted_at alanını doldurur.

create table if not exists public.mockup_templates (
    id uuid primary key,
    name text not null check (char_length(trim(name)) between 1 and 120),
    schema_version integer not null default 2 check (schema_version > 0),
    current_version integer not null default 0 check (current_version >= 0),
    canvas_width integer not null default 2000 check (canvas_width = 2000),
    canvas_height integer not null default 2000 check (canvas_height = 2000),
    status text not null default 'draft' check (status in ('draft', 'approved')),
    document jsonb not null default '{}'::jsonb,
    layer_count integer not null default 0 check (layer_count >= 0),
    slot_count integer not null default 0 check (slot_count >= 0),
    thumbnail_asset_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

create table if not exists public.mockup_assets (
    id uuid primary key,
    template_id uuid references public.mockup_templates(id) on delete set null,
    asset_scope text not null default 'template'
        check (asset_scope in ('template', 'product', 'output')),
    asset_type text not null check (
        asset_type in (
            'scene_background', 'product_box_clean', 'product_only_clean',
            'original_photo', 'foreground_mask', 'optional_graphic',
            'template_thumbnail', 'output'
        )
    ),
    storage_path text not null unique,
    original_filename text not null,
    mime_type text not null,
    size_bytes bigint not null check (size_bytes > 0),
    created_at timestamptz not null default now(),
    deleted_at timestamptz
);

alter table public.mockup_templates
    drop constraint if exists mockup_templates_thumbnail_asset_id_fkey;
alter table public.mockup_templates
    add constraint mockup_templates_thumbnail_asset_id_fkey
    foreign key (thumbnail_asset_id) references public.mockup_assets(id) on delete set null;

create table if not exists public.mockup_template_versions (
    id uuid primary key default gen_random_uuid(),
    template_id uuid references public.mockup_templates(id) on delete set null,
    template_name text not null,
    version_number integer not null check (version_number > 0),
    snapshot jsonb not null,
    created_at timestamptz not null default now(),
    unique (template_id, version_number)
);

create table if not exists public.mockup_outputs (
    id uuid primary key,
    name text not null check (char_length(trim(name)) between 1 and 160),
    export_asset_id uuid not null references public.mockup_assets(id) on delete restrict,
    product_asset_id uuid not null references public.mockup_assets(id) on delete restrict,
    template_id uuid references public.mockup_templates(id) on delete set null,
    template_name text not null,
    template_version integer not null check (template_version > 0),
    template_snapshot jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    approved_at timestamptz,
    deleted_at timestamptz
);

create index if not exists mockup_templates_active_updated_idx
    on public.mockup_templates(updated_at desc) where deleted_at is null;
create index if not exists mockup_assets_template_id_idx
    on public.mockup_assets(template_id);
create index if not exists mockup_assets_product_idx
    on public.mockup_assets(created_at desc)
    where asset_scope = 'product' and deleted_at is null;
create index if not exists mockup_template_versions_template_idx
    on public.mockup_template_versions(template_id, version_number desc);
create index if not exists mockup_outputs_active_created_idx
    on public.mockup_outputs(created_at desc) where deleted_at is null;

create or replace function public.set_mockup_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_mockup_template_updated_at on public.mockup_templates;
create trigger set_mockup_template_updated_at
before update on public.mockup_templates
for each row execute function public.set_mockup_updated_at();

drop trigger if exists set_mockup_output_updated_at on public.mockup_outputs;
create trigger set_mockup_output_updated_at
before update on public.mockup_outputs
for each row execute function public.set_mockup_updated_at();

-- Şablon kaydı ve değiştirilemez sürüm snapshot'ı tek transaction içinde oluşturulur.
create or replace function public.save_mockup_template(
    p_id uuid,
    p_name text,
    p_schema_version integer,
    p_document jsonb,
    p_layer_count integer,
    p_slot_count integer
)
returns public.mockup_templates
language plpgsql
security definer
set search_path = public
as $$
declare
    saved public.mockup_templates;
begin
    if char_length(trim(p_name)) = 0 then
        raise exception 'Şablon adı zorunludur.';
    end if;

    insert into public.mockup_templates (
        id, name, schema_version, current_version, canvas_width, canvas_height,
        status, document, layer_count, slot_count, deleted_at
    ) values (
        p_id, trim(p_name), p_schema_version, 1, 2000, 2000,
        'draft', p_document, p_layer_count, p_slot_count, null
    )
    on conflict (id) do update set
        name = excluded.name,
        schema_version = excluded.schema_version,
        current_version = public.mockup_templates.current_version + 1,
        document = excluded.document,
        layer_count = excluded.layer_count,
        slot_count = excluded.slot_count,
        deleted_at = null
    returning * into saved;

    insert into public.mockup_template_versions (
        template_id, template_name, version_number, snapshot
    ) values (
        saved.id, saved.name, saved.current_version, saved.document
    );

    return saved;
end;
$$;

alter table public.mockup_templates enable row level security;
alter table public.mockup_assets enable row level security;
alter table public.mockup_template_versions enable row level security;
alter table public.mockup_outputs enable row level security;

revoke all on public.mockup_templates from anon, authenticated;
revoke all on public.mockup_assets from anon, authenticated;
revoke all on public.mockup_template_versions from anon, authenticated;
revoke all on public.mockup_outputs from anon, authenticated;
revoke execute on function public.save_mockup_template(uuid, text, integer, jsonb, integer, integer)
    from public, anon, authenticated;

grant all on public.mockup_templates to service_role;
grant all on public.mockup_assets to service_role;
grant all on public.mockup_template_versions to service_role;
grant all on public.mockup_outputs to service_role;
grant execute on function public.save_mockup_template(uuid, text, integer, jsonb, integer, integer)
    to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'mockup-studio-assets',
    'mockup-studio-assets',
    false,
    20971520,
    array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Bucket private kalır. Browser yalnızca Python API üzerinden erişir.
