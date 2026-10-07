import type { AuthUser } from '@interview-lab/shared';
import { NavLink } from 'react-router-dom';
import { useMoneyVisibility } from '../../hooks/useMoneyVisibility';
import type { ThemeMode } from '../../hooks/useTheme';
import { CATALOG_PATH, CHAT_PATH, DASHBOARD_PATH } from '../../routes';
import { Button } from '../ui/Button';
import { EyeIcon, EyeOffIcon, MoonIcon, RouteIcon, SunIcon } from '../ui/icons';

interface TopBarProps {
  user: AuthUser;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => void;
}

const LINKS = [
  { to: DASHBOARD_PATH, label: 'Dashboard' },
  { to: CHAT_PATH, label: 'Converse com seus dados' },
];
const CATALOG_LINK = { to: CATALOG_PATH, label: 'Cadastro' };

const ICON_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-line bg-surface text-text-2 hover:border-line-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent';

const MAX_INITIALS = 2;

// First letters of the first and last names: "Carla Souza" becomes "CS".
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > MAX_INITIALS ? [words[0], words.at(-1)] : words;
  return picked.map((word) => word?.charAt(0).toUpperCase() ?? '').join('');
}

// The bar above every screen: brand, navigation, the eye that hides the
// amounts in reais (D-62), theme and the signed-in user
// (D-48: name and initials as the server knows them, and the way out).
export function TopBar({ user, theme, onToggleTheme, onLogout }: TopBarProps) {
  // The server says who may use the registry; the link follows that.
  const links = user.canManageCatalog ? [...LINKS, CATALOG_LINK] : LINKS;
  const { money, toggleMoney } = useMoneyVisibility();

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-5 border-b border-line bg-surface px-5">
      <div className="flex shrink-0 items-center gap-[9px]">
        <div
          aria-hidden="true"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-text text-bg"
        >
          <RouteIcon size={15} strokeWidth={1.8} />
        </div>
        <span className="text-[14.5px] font-bold tracking-[-0.01em]">Rota Materiais</span>
      </div>

      <nav aria-label="Principal" className="flex h-full items-stretch gap-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `flex items-center border-b-2 px-2.5 text-[13.5px] whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                isActive
                  ? 'border-accent font-semibold text-text'
                  : 'border-transparent font-medium text-text-2 hover:text-text'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={toggleMoney}
        aria-pressed={money.hidden}
        aria-label="Ocultar valores em reais"
        title={money.hidden ? 'Mostrar valores em reais' : 'Ocultar valores em reais'}
        className={ICON_BUTTON_CLASS}
      >
        {money.hidden ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
      </button>

      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
        className={ICON_BUTTON_CLASS}
      >
        {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <div
          aria-hidden="true"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-text-2"
        >
          {initialsOf(user.name)}
        </div>
        <span
          className="hidden min-w-0 truncate text-[13px] font-semibold sm:block"
          title={user.email}
        >
          {user.name}
        </span>
        <Button variant="ghost" size="md" onClick={onLogout}>
          Sair
        </Button>
      </div>
    </header>
  );
}
