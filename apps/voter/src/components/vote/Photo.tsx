// A person's photo in the 5:7 frame, or the neutral initials avatar in the same box (Design
// System 10.3: neutral for everyone, so no contester gets a colour). Alt text is the name.
import { initials } from '../../format';

interface PhotoProps {
  url: string | null;
  name: string;
  size?: 'card' | 'large' | 'row';
}

export function Photo({ url, name, size = 'card' }: PhotoProps) {
  const sizeClass = size === 'large' ? 'vk-photo--large' : size === 'row' ? 'vk-photo--row' : '';
  if (url) return <img src={url} alt={name} className={`vk-photo ${sizeClass}`} />;
  return (
    <span role="img" aria-label={name} className={`vk-photo vk-photo--initials ${sizeClass}`}>
      {initials(name)}
    </span>
  );
}
