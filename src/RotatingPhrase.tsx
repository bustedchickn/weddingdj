import {useEffect, useState} from 'react';
export const celebrationPhrases = ['a night', 'a crazy party', 'una fiesta', 'a sick conclave', 'a smashing jamboree', 'une fête', 'a story', 'a wedding', 'a harmony', 'a dance'];
export default function RotatingPhrase() {
  const [phrase, setPhrase] = useState(celebrationPhrases[0]);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timeout: ReturnType<typeof setTimeout>;
    let index = 0, length = celebrationPhrases[0].length, deleting = true;
    const tick = () => {
      const word = celebrationPhrases[index];
      if (deleting) {
        length--; setPhrase(word.slice(0, Math.max(0, length)));
        if (length <= 0) { index = (index + 1) % celebrationPhrases.length; deleting = false; timeout = setTimeout(tick, 350); }
        else timeout = setTimeout(tick, 55);
      } else {
        length++; setPhrase(word.slice(0, length));
        if (length >= word.length) { deleting = true; timeout = setTimeout(tick, 1900); }
        else timeout = setTimeout(tick, 90);
      }
    };
    const apply = () => {
      clearTimeout(timeout); setReduced(preference.matches);
      index = 0; length = celebrationPhrases[0].length; deleting = true; setPhrase(celebrationPhrases[0]);
      if (!preference.matches) timeout = setTimeout(tick, 2300);
    };
    apply(); preference.addEventListener('change', apply);
    return () => { clearTimeout(timeout); preference.removeEventListener('change', apply); };
  }, []);
  return <span className={`rotating-phrase ${reduced ? 'reduced' : ''}`} aria-hidden="true"><span>{phrase || '\u00a0'}</span><span className="type-caret"/></span>;
}
