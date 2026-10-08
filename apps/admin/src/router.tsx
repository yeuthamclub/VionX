import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { isGroup, NAV, navLeaves } from './nav.ts';
import { DashboardPage, LoginPage, NotFoundPage, StubPage } from './pages.tsx';

function Shell() {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Admin">
        <div className="brand">VionX Admin</div>
        <ul>
          {NAV.map((entry) =>
            isGroup(entry) ? (
              <li key={entry.label}>
                <span className="group">{entry.label}</span>
                <ul>
                  {entry.children.map((leaf) => (
                    <li key={leaf.path}>
                      <Link to={leaf.path} activeProps={{ className: 'active' }}>
                        {leaf.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li key={entry.path}>
                <Link
                  to={entry.path}
                  activeOptions={{ exact: true }}
                  activeProps={{ className: 'active' }}
                >
                  {entry.label}
                </Link>
              </li>
            ),
          )}
        </ul>
        <Link to="/login" className="signout">
          Sign out
        </Link>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundPage });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: Shell });

const pageRoutes = navLeaves().map((leaf) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path: leaf.path,
    component: leaf.path === '/' ? DashboardPage : () => <StubPage leaf={leaf} />,
  }),
);

const routeTree = rootRoute.addChildren([loginRoute, shellRoute.addChildren(pageRoutes)]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
