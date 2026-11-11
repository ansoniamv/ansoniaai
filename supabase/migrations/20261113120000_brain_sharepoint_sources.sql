-- Brain sources from SharePoint.
--
-- SharePoint (the Acquisitions and Asset Management sites) is now where the
-- Brain's documents live. Atlas searches and reads both sites live; a Brain
-- source of kind 'sharepoint' is a file an admin pinned so that it is read,
-- summarised and compiled into the Company Brief, the way an upload was.
-- Nothing is copied into storage: process-data-room-source downloads the file
-- from SharePoint through Graph each time it reads it.
--
-- Uploads ('file') keep working for the sources that already exist; the page
-- no longer offers new ones. Websites and notes are unchanged.
--
-- Additive only. The live category check (which has categories added by hand,
-- model_template and affordability) is not touched.

ALTER TABLE public.data_room_sources DROP CONSTRAINT IF EXISTS data_room_sources_kind_check;
ALTER TABLE public.data_room_sources ADD CONSTRAINT data_room_sources_kind_check
  CHECK (kind IN ('file', 'website', 'note', 'sharepoint'));

ALTER TABLE public.data_room_sources
  -- Which granted site: 'acquisitions' (/sites/Acquisitions2) or 'asset_management'.
  ADD COLUMN IF NOT EXISTS sp_site             text,
  -- Graph driveItem id in that site's document library. Survives renames and moves.
  ADD COLUMN IF NOT EXISTS sp_item_id          text,
  ADD COLUMN IF NOT EXISTS sp_web_url          text,
  -- Folder within the library, e.g. "Owned Properties/1015 Villages at Canterfield".
  ADD COLUMN IF NOT EXISTS sp_folder           text,
  -- SharePoint's lastModifiedDateTime of the version that was read.
  ADD COLUMN IF NOT EXISTS sp_modified         timestamptz,
  -- lastModifiedDateTime seen at the last check; later than sp_modified = changed since read.
  ADD COLUMN IF NOT EXISTS sp_current_modified timestamptz,
  ADD COLUMN IF NOT EXISTS sp_checked_at       timestamptz,
  -- The file was not found at the last check (deleted, or moved out of the granted sites).
  ADD COLUMN IF NOT EXISTS sp_missing          boolean NOT NULL DEFAULT false;

ALTER TABLE public.data_room_sources DROP CONSTRAINT IF EXISTS data_room_sharepoint_has_item;
ALTER TABLE public.data_room_sources ADD CONSTRAINT data_room_sharepoint_has_item
  CHECK (kind <> 'sharepoint' OR (sp_site IN ('acquisitions', 'asset_management') AND sp_item_id IS NOT NULL));

-- One Brain source per SharePoint file.
CREATE UNIQUE INDEX IF NOT EXISTS data_room_sources_sharepoint_item_idx
  ON public.data_room_sources (sp_site, sp_item_id)
  WHERE kind = 'sharepoint';
