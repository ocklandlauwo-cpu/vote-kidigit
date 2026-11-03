// Placeholder for PUB-01, VTR-WEB-01 and RES-04 until those screens are built.
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

interface PlaceholderPageProps {
  screenId: string;
}

export function PlaceholderPage({ screenId }: PlaceholderPageProps) {
  return (
    <main className="mx-auto max-w-120 p-4" data-screen-id={screenId}>
      <div className="flex items-center justify-between">
        <Logo lockup="horizontal-small" />
        <ThemeToggle />
      </div>
      <h1 className="mt-6 text-h1 font-semibold">{PRODUCT_NAME}</h1>
    </main>
  );
}
