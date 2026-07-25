create extension if not exists pgcrypto;

create or replace function public.set_orion_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.orion_products (
  id text primary key,
  canonical_name text not null,
  brand text not null default '',
  category text not null default '',
  description text not null default '',
  specifications jsonb not null default '{}'::jsonb,
  current_price_amount numeric(14, 2),
  current_price_currency text,
  list_price_amount numeric(14, 2),
  list_price_currency text,
  rating numeric(3, 2) check (rating is null or rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  marketplace_source text not null,
  source_product_id text not null,
  source_url text not null,
  tags jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  imported_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (marketplace_source, source_product_id)
);

create table if not exists public.orion_runs (
  id text primary key,
  schema_version text not null,
  mode text not null,
  adapter text not null,
  status text not null default 'planned',
  source_device text not null default '',
  currency text not null default 'USD',
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  incurred_cost numeric(14, 4) not null default 0 check (incurred_cost >= 0),
  config jsonb not null default '{}'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_run_products (
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text not null references public.orion_products(id) on delete restrict,
  sequence_index integer not null default 0 check (sequence_index >= 0),
  role text not null default 'featured',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (run_id, product_id),
  unique (run_id, sequence_index)
);

create table if not exists public.orion_source_snapshots (
  id text primary key,
  run_id text references public.orion_runs(id) on delete set null,
  product_id text not null references public.orion_products(id) on delete cascade,
  provider text not null,
  source_url text not null,
  retrieved_at timestamptz not null,
  retrieval_method text not null,
  source_access_permitted boolean not null default false,
  content_sha256 text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.orion_product_scores (
  id text primary key,
  run_id text references public.orion_runs(id) on delete set null,
  product_id text not null references public.orion_products(id) on delete cascade,
  scoring_version text not null,
  dimensions jsonb not null default '{}'::jsonb,
  weights jsonb not null default '{}'::jsonb,
  overall_score numeric(5, 2) not null check (overall_score between 0 and 100),
  expected_roi jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_assets (
  id text primary key,
  run_id text references public.orion_runs(id) on delete set null,
  product_id text references public.orion_products(id) on delete set null,
  parent_asset_id text references public.orion_assets(id) on delete set null,
  asset_kind text not null,
  media_type text not null,
  source_provider text not null,
  source_url text,
  source_page_url text,
  retrieved_at timestamptz,
  retrieval_method text not null,
  content_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  mime_type text,
  duration_seconds numeric(12, 3) check (duration_seconds is null or duration_seconds >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  rights_status text not null default 'unverified',
  rights_basis text not null default 'unknown',
  rights_evidence text,
  attribution_required boolean not null default false,
  attribution_text text,
  approval_status text not null default 'pending',
  usage_scope text not null default 'publication',
  usage_notes jsonb not null default '[]'::jsonb,
  lifecycle_status text not null default 'referenced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  check (not attribution_required or attribution_text is not null)
);

create table if not exists public.orion_media_locations (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null references public.orion_assets(id) on delete cascade,
  location_type text not null,
  device_id text not null default '',
  uri text not null,
  status text not null default 'available',
  content_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  last_verified_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (asset_id, location_type, device_id, uri),
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.orion_script_jobs (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text not null references public.orion_products(id) on delete cascade,
  angle text not null,
  target_duration_seconds integer not null check (target_duration_seconds between 10 and 600),
  prompt_version text not null,
  creative_brief jsonb not null default '{}'::jsonb,
  model_plan jsonb not null default '{}'::jsonb,
  status text not null default 'planned',
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_script_variants (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  script_job_id text not null references public.orion_script_jobs(id) on delete restrict,
  parent_variant_id text references public.orion_script_variants(id) on delete set null,
  angle text not null,
  target_duration_seconds integer not null check (target_duration_seconds between 10 and 600),
  hook text not null,
  body text not null,
  closing_line text not null,
  spoken_text text not null,
  affiliate_disclosure text not null default '',
  generation_provider text not null,
  model text not null,
  prompt_version text not null default '',
  revision_number integer not null default 1 check (revision_number >= 1),
  revision_reason text not null default '',
  status text not null default 'awaiting_approval',
  approval_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_script_revisions (
  id text primary key,
  script_variant_id text not null references public.orion_script_variants(id) on delete cascade,
  previous_spoken_text text not null,
  revised_spoken_text text not null,
  revised_by text not null,
  reason text not null,
  revised_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_voice_jobs (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  script_job_id text not null references public.orion_script_jobs(id) on delete restrict,
  script_variant_id text references public.orion_script_variants(id) on delete restrict,
  output_asset_id text references public.orion_assets(id) on delete set null,
  provider text not null,
  profile_id text not null,
  model text not null,
  voice text not null,
  language text not null,
  synthesis_settings jsonb not null default '{}'::jsonb,
  status text not null default 'planned',
  blockers jsonb not null default '[]'::jsonb,
  duration_seconds numeric(12, 3) check (duration_seconds is null or duration_seconds >= 0),
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  execution_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_caption_jobs (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  script_job_id text not null references public.orion_script_jobs(id) on delete restrict,
  voice_job_id text not null references public.orion_voice_jobs(id) on delete restrict,
  words_asset_id text references public.orion_assets(id) on delete set null,
  captions_asset_id text references public.orion_assets(id) on delete set null,
  provider text not null,
  model text not null,
  language text not null,
  timing_mode text not null,
  max_words_per_line integer not null default 4 check (max_words_per_line between 1 and 8),
  words jsonb not null default '[]'::jsonb,
  duration_seconds numeric(12, 3) not null default 0 check (duration_seconds >= 0),
  status text not null default 'planned',
  blockers jsonb not null default '[]'::jsonb,
  execution_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_render_jobs (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  script_job_id text not null references public.orion_script_jobs(id) on delete restrict,
  script_variant_id text references public.orion_script_variants(id) on delete restrict,
  voice_job_id text not null references public.orion_voice_jobs(id) on delete restrict,
  caption_job_id text not null references public.orion_caption_jobs(id) on delete restrict,
  output_asset_id text references public.orion_assets(id) on delete set null,
  renderer text not null,
  render_purpose text not null,
  publication_eligible boolean not null default false,
  watermark_required boolean not null default false,
  template_id text not null,
  aspect_ratio text not null default '9:16',
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  fps integer not null check (fps between 1 and 120),
  platform_targets jsonb not null default '[]'::jsonb,
  status text not null default 'planned',
  blockers jsonb not null default '[]'::jsonb,
  estimated_cost numeric(14, 4) not null default 0 check (estimated_cost >= 0),
  execution_plan jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_render_clips (
  id text primary key,
  render_job_id text not null references public.orion_render_jobs(id) on delete cascade,
  asset_id text not null references public.orion_assets(id) on delete restrict,
  sequence_index integer not null check (sequence_index >= 0),
  role text not null,
  media_type text not null,
  source_start_seconds numeric(12, 3) not null default 0 check (source_start_seconds >= 0),
  duration_seconds numeric(12, 3) not null check (duration_seconds > 0),
  fit text not null default 'cover',
  crop_settings jsonb not null default '{}'::jsonb,
  transition_after text not null default 'cut',
  transition_duration_seconds numeric(6, 3) not null default 0
    check (transition_duration_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (render_job_id, sequence_index),
  check (
    (transition_after = 'cut' and transition_duration_seconds = 0)
    or (transition_after <> 'cut' and transition_duration_seconds > 0)
  )
);

create table if not exists public.orion_approvals (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  stage text not null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  task_id text not null unique,
  state text not null default 'pending',
  blocking_reasons jsonb not null default '[]'::jsonb,
  requested_at timestamptz not null,
  requested_by text not null,
  decided_at timestamptz,
  decided_by text,
  decision_reason text not null default '',
  discord_channel_id text,
  discord_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_affiliate_links (
  id text primary key,
  product_id text not null references public.orion_products(id) on delete cascade,
  provider text not null,
  destination_url text not null,
  tracking_url text,
  disclosure text not null,
  status text not null default 'pending',
  approval_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orion_publications (
  id text primary key,
  run_id text not null references public.orion_runs(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  render_job_id text not null references public.orion_render_jobs(id) on delete restrict,
  affiliate_link_id text references public.orion_affiliate_links(id) on delete set null,
  platform text not null,
  account_key text not null,
  external_id text,
  title text not null,
  description text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  disclosure text not null default '',
  visibility text not null default 'private',
  status text not null default 'planned',
  preview_url text,
  public_url text,
  scheduled_for timestamptz,
  uploaded_at timestamptz,
  published_at timestamptz,
  rejected_at timestamptz,
  deleted_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (platform, account_key, external_id)
);

create table if not exists public.orion_analytics_snapshots (
  id text primary key,
  publication_id text not null references public.orion_publications(id) on delete cascade,
  product_id text references public.orion_products(id) on delete set null,
  platform text not null,
  captured_at timestamptz not null,
  views bigint not null default 0 check (views >= 0),
  likes bigint not null default 0 check (likes >= 0),
  comments bigint not null default 0 check (comments >= 0),
  shares bigint not null default 0 check (shares >= 0),
  watch_time_seconds numeric(18, 3) not null default 0 check (watch_time_seconds >= 0),
  average_view_duration_seconds numeric(12, 3) not null default 0
    check (average_view_duration_seconds >= 0),
  average_percentage_viewed numeric(7, 4)
    check (average_percentage_viewed is null or average_percentage_viewed between 0 and 100),
  clicks bigint not null default 0 check (clicks >= 0),
  conversions bigint not null default 0 check (conversions >= 0),
  revenue numeric(14, 4) not null default 0,
  currency text not null default 'USD',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (publication_id, captured_at)
);

create index if not exists orion_products_status_idx
  on public.orion_products (status);
create index if not exists orion_products_category_idx
  on public.orion_products (category);
create index if not exists orion_runs_status_created_at_idx
  on public.orion_runs (status, created_at desc);
create index if not exists orion_run_products_product_idx
  on public.orion_run_products (product_id, run_id);
create index if not exists orion_source_snapshots_product_retrieved_idx
  on public.orion_source_snapshots (product_id, retrieved_at desc);
create index if not exists orion_product_scores_product_scored_idx
  on public.orion_product_scores (product_id, scored_at desc);
create index if not exists orion_assets_product_kind_idx
  on public.orion_assets (product_id, asset_kind);
create index if not exists orion_assets_sha256_idx
  on public.orion_assets (content_sha256);
create index if not exists orion_assets_rights_approval_idx
  on public.orion_assets (rights_status, approval_status);
create index if not exists orion_media_locations_asset_status_idx
  on public.orion_media_locations (asset_id, status);
create index if not exists orion_script_jobs_run_status_idx
  on public.orion_script_jobs (run_id, status);
create index if not exists orion_script_variants_product_created_idx
  on public.orion_script_variants (product_id, created_at desc);
create index if not exists orion_script_variants_run_status_idx
  on public.orion_script_variants (run_id, status);
create index if not exists orion_script_revisions_variant_revised_idx
  on public.orion_script_revisions (script_variant_id, revised_at desc);
create index if not exists orion_voice_jobs_run_status_idx
  on public.orion_voice_jobs (run_id, status);
create index if not exists orion_caption_jobs_run_status_idx
  on public.orion_caption_jobs (run_id, status);
create index if not exists orion_render_jobs_run_status_idx
  on public.orion_render_jobs (run_id, status);
create index if not exists orion_render_clips_render_sequence_idx
  on public.orion_render_clips (render_job_id, sequence_index);
create index if not exists orion_approvals_state_requested_idx
  on public.orion_approvals (state, requested_at);
create index if not exists orion_approvals_subject_idx
  on public.orion_approvals (subject_type, subject_id);
create index if not exists orion_publications_platform_status_idx
  on public.orion_publications (platform, status);
create index if not exists orion_publications_schedule_idx
  on public.orion_publications (scheduled_for)
  where status = 'scheduled';
create index if not exists orion_analytics_publication_captured_idx
  on public.orion_analytics_snapshots (publication_id, captured_at desc);

drop trigger if exists set_orion_products_updated_at on public.orion_products;
create trigger set_orion_products_updated_at
before update on public.orion_products
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_runs_updated_at on public.orion_runs;
create trigger set_orion_runs_updated_at
before update on public.orion_runs
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_assets_updated_at on public.orion_assets;
create trigger set_orion_assets_updated_at
before update on public.orion_assets
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_media_locations_updated_at on public.orion_media_locations;
create trigger set_orion_media_locations_updated_at
before update on public.orion_media_locations
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_script_jobs_updated_at on public.orion_script_jobs;
create trigger set_orion_script_jobs_updated_at
before update on public.orion_script_jobs
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_script_variants_updated_at on public.orion_script_variants;
create trigger set_orion_script_variants_updated_at
before update on public.orion_script_variants
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_voice_jobs_updated_at on public.orion_voice_jobs;
create trigger set_orion_voice_jobs_updated_at
before update on public.orion_voice_jobs
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_caption_jobs_updated_at on public.orion_caption_jobs;
create trigger set_orion_caption_jobs_updated_at
before update on public.orion_caption_jobs
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_render_jobs_updated_at on public.orion_render_jobs;
create trigger set_orion_render_jobs_updated_at
before update on public.orion_render_jobs
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_render_clips_updated_at on public.orion_render_clips;
create trigger set_orion_render_clips_updated_at
before update on public.orion_render_clips
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_approvals_updated_at on public.orion_approvals;
create trigger set_orion_approvals_updated_at
before update on public.orion_approvals
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_affiliate_links_updated_at on public.orion_affiliate_links;
create trigger set_orion_affiliate_links_updated_at
before update on public.orion_affiliate_links
for each row execute function public.set_orion_updated_at();

drop trigger if exists set_orion_publications_updated_at on public.orion_publications;
create trigger set_orion_publications_updated_at
before update on public.orion_publications
for each row execute function public.set_orion_updated_at();

alter table public.orion_products enable row level security;
alter table public.orion_runs enable row level security;
alter table public.orion_run_products enable row level security;
alter table public.orion_source_snapshots enable row level security;
alter table public.orion_product_scores enable row level security;
alter table public.orion_assets enable row level security;
alter table public.orion_media_locations enable row level security;
alter table public.orion_script_jobs enable row level security;
alter table public.orion_script_variants enable row level security;
alter table public.orion_script_revisions enable row level security;
alter table public.orion_voice_jobs enable row level security;
alter table public.orion_caption_jobs enable row level security;
alter table public.orion_render_jobs enable row level security;
alter table public.orion_render_clips enable row level security;
alter table public.orion_approvals enable row level security;
alter table public.orion_affiliate_links enable row level security;
alter table public.orion_publications enable row level security;
alter table public.orion_analytics_snapshots enable row level security;

revoke all on public.orion_products from anon, authenticated;
revoke all on public.orion_runs from anon, authenticated;
revoke all on public.orion_run_products from anon, authenticated;
revoke all on public.orion_source_snapshots from anon, authenticated;
revoke all on public.orion_product_scores from anon, authenticated;
revoke all on public.orion_assets from anon, authenticated;
revoke all on public.orion_media_locations from anon, authenticated;
revoke all on public.orion_script_jobs from anon, authenticated;
revoke all on public.orion_script_variants from anon, authenticated;
revoke all on public.orion_script_revisions from anon, authenticated;
revoke all on public.orion_voice_jobs from anon, authenticated;
revoke all on public.orion_caption_jobs from anon, authenticated;
revoke all on public.orion_render_jobs from anon, authenticated;
revoke all on public.orion_render_clips from anon, authenticated;
revoke all on public.orion_approvals from anon, authenticated;
revoke all on public.orion_affiliate_links from anon, authenticated;
revoke all on public.orion_publications from anon, authenticated;
revoke all on public.orion_analytics_snapshots from anon, authenticated;

grant all on public.orion_products to postgres, service_role;
grant all on public.orion_runs to postgres, service_role;
grant all on public.orion_run_products to postgres, service_role;
grant all on public.orion_source_snapshots to postgres, service_role;
grant all on public.orion_product_scores to postgres, service_role;
grant all on public.orion_assets to postgres, service_role;
grant all on public.orion_media_locations to postgres, service_role;
grant all on public.orion_script_jobs to postgres, service_role;
grant all on public.orion_script_variants to postgres, service_role;
grant all on public.orion_script_revisions to postgres, service_role;
grant all on public.orion_voice_jobs to postgres, service_role;
grant all on public.orion_caption_jobs to postgres, service_role;
grant all on public.orion_render_jobs to postgres, service_role;
grant all on public.orion_render_clips to postgres, service_role;
grant all on public.orion_approvals to postgres, service_role;
grant all on public.orion_affiliate_links to postgres, service_role;
grant all on public.orion_publications to postgres, service_role;
grant all on public.orion_analytics_snapshots to postgres, service_role;

create or replace view public.orion_product_overview
with (security_invoker = true)
as
select
  product.id,
  product.canonical_name,
  product.brand,
  product.category,
  product.status,
  count(distinct script.id) as script_variant_count,
  count(distinct publication.id) as publication_count,
  count(distinct publication.id)
    filter (where publication.status = 'published') as published_count,
  max(publication.published_at) as last_published_at,
  case
    when max(publication.published_at) is null then null
    else floor(extract(epoch from (
      timezone('utc', now()) - max(publication.published_at)
    )) / 86400)::integer
  end as days_since_last_publication,
  max(publication.updated_at) as last_publication_activity_at
from public.orion_products product
left join public.orion_script_variants script
  on script.product_id = product.id
left join public.orion_publications publication
  on publication.product_id = product.id
group by product.id;

revoke all on public.orion_product_overview from anon, authenticated;
grant select on public.orion_product_overview to postgres, service_role;
