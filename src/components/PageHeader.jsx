import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/**
 * ACACIA portfolio page header — shared, byte-identical across every app
 * (module 29). Same three things, same places, on every screen:
 *
 *   breadcrumb  (where this page sits — every crumb but the last is a link)
 *   title                                              actions (right-aligned)
 *
 * Actions: at most one primary button, the rest outline/ghost. A page with
 * five filled buttons has no primary action; that is the clarity this module
 * is about. On a phone the actions wrap under the title instead of squeezing it.
 *
 * @param {object} props
 * @param {Array<{label: string, to?: string}>} [props.breadcrumbs]
 * @param {string} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions]
 */
export default function PageHeader({ breadcrumbs = [], title, description, actions }) {
  return (
    <div className="mb-6">
      {breadcrumbs.length ? (
        <nav aria-label="Ruta" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <Fragment key={`${crumb.label}-${index}`}>
                  <li className="min-w-0">
                    {crumb.to && !last ? (
                      <Link
                        to={crumb.to}
                        className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? 'page' : undefined} className="text-muted-foreground">
                        {crumb.label}
                      </span>
                    )}
                  </li>
                  {last ? null : (
                    <li aria-hidden="true" className="text-muted-foreground">
                      ›
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
