import { init } from './lib/initialize';

const Monek = init;

if (typeof window !== 'undefined') {
    (window as any).Monek = Monek;
}

export { Monek };
export default Monek;
