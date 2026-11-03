// Placeholder for PUB-01, VTR-WEB-01 and RES-04 until those screens are built.
import { PRODUCT_NAME } from '@vote-kidigit/shared';

interface PlaceholderPageProps {
  screenId: string;
}

export function PlaceholderPage({ screenId }: PlaceholderPageProps) {
  return (
    <main className="mx-auto max-w-120 p-4" data-screen-id={screenId}>
      <h1 className="text-2xl font-semibold">{PRODUCT_NAME}</h1>
    </main>
  );
}
