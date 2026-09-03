import { useState } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DealThumbnailProps {
  photos?: string[] | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  size?: number;
  className?: string;
  alt?: string;
}

function esriSatelliteUrl(lat: number, lon: number, sizePx: number): string {
  const dLon = 0.0012;
  const dLat = 0.0009;
  const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
  const s = Math.max(64, Math.round(sizePx * 2));
  return `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${s},${s}&format=jpg&f=image`;
}

export function DealThumbnail({
  photos,
  latitude,
  longitude,
  size = 44,
  className,
  alt = "Property thumbnail",
}: DealThumbnailProps) {
  const [errored, setErrored] = useState(false);

  const photo = photos && photos.length > 0 ? photos[0] : null;
  const lat = latitude != null ? Number(latitude) : null;
  const lon = longitude != null ? Number(longitude) : null;
  const hasCoords =
    lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);

  const src = !errored
    ? photo ?? (hasCoords ? esriSatelliteUrl(lat!, lon!, size) : null)
    : null;

  const baseClass = cn(
    "shrink-0 rounded-sm border border-hairline bg-muted overflow-hidden",
    className,
  );
  const style = { width: size, height: size };

  if (!src) {
    return (
      <div
        className={cn(baseClass, "flex items-center justify-center text-muted-foreground")}
        style={style}
        aria-label="No property image"
      >
        <Building2 className="h-4 w-4" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className={cn(baseClass, "object-cover")}
      style={style}
    />
  );
}

export default DealThumbnail;
