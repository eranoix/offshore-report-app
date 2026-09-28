create table if not exists offshore_report_templates (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  version       int  not null,
  path          text,
  sha256        text,
  size          int,
  anchors       jsonb not null default '{}'::jsonb,
  blanks        jsonb not null default '{}'::jsonb,
  wording       jsonb not null default '{}'::jsonb,
  note          text,
  created_by    uuid,
  created_email text,
  created_at    timestamptz not null default now(),
  unique (kind, version)
);

create table if not exists offshore_report_templates_live (
  kind         text primary key,
  template_id  uuid not null references offshore_report_templates(id),
  updated_at   timestamptz not null default now(),
  updated_by   text
);

alter table offshore_report_templates enable row level security;
alter table offshore_report_templates_live enable row level security;

drop policy if exists read_templates on offshore_report_templates;
create policy read_templates on offshore_report_templates for select
  using (auth.role() = 'authenticated');

drop policy if exists read_live on offshore_report_templates_live;
create policy read_live on offshore_report_templates_live for select
  using (auth.role() = 'authenticated');

grant select on offshore_report_templates, offshore_report_templates_live to authenticated;

insert into storage.buckets (id, name, public)
  values ('offshore-report-templates', 'offshore-report-templates', false)
  on conflict (id) do nothing;
