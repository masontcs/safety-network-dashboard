import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'

export const metadata: Metadata = { title: 'How to use' }

/**
 * "How to use" — static help for every CMR role (Controller, Requester, Viewer). The content is
 * the same for everyone and explains the role differences itself. No data, no API calls.
 *
 * The (secure) layout is the gate (explicit grant only, no admin inheritance); this repeats it,
 * like every other CMR page, so the page can never render on its own.
 */
export default async function CmrHelpPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')

  return (
    <article className="cmr-help">
      <header className="cmr-pagehead">
        <div>
          <h1 className="cmr-serif">Cash Ledger — How to use</h1>
        </div>
      </header>

      <section className="cmr-sec" aria-labelledby="cmr-help-what">
        <div className="cmr-card cmr-help-card">
          <p id="cmr-help-what">
            <strong>What this is.</strong> SN Cash Ledger is the single place to manage the company&rsquo;s
            daily cash: what&rsquo;s in the bank, what&rsquo;s going out today, what&rsquo;s due this week, and
            what recurring payments are coming up. It replaces the manual cash sheet. Access is invite-only —
            being an admin in another Safety Network tool does <strong>not</strong> get you in here; someone has
            to grant you access on the Access screen.
          </p>
        </div>
      </section>

      <section className="cmr-sec" aria-labelledby="cmr-help-roles">
        <h2 className="cmr-serif cmr-help-h2" id="cmr-help-roles">Who can do what</h2>
        <div className="cmr-card">
          <table className="cmr-help-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Can do</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><span className="cmr-pill controller">Controller</span></th>
                <td>
                  Everything — edit the daily ledger, priorities, accounts and recurring vendors; place and
                  decline requests; add recurring due-payments; and manage who has access.
                </td>
              </tr>
              <tr>
                <th scope="row"><span className="cmr-pill requester">Requester</span></th>
                <td>
                  See everything, and submit vendor payment requests. That&rsquo;s the one thing a Requester
                  changes — everything else is read-only for them.
                </td>
              </tr>
              <tr>
                <th scope="row"><span className="cmr-pill viewer">Viewer</span></th>
                <td>See everything, change nothing.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="cmr-help-after">
          Only a Controller sees the <strong>Settings</strong> section (Accounts and Access) and the buttons that
          add or edit money.
        </p>
      </section>

      <section className="cmr-sec" aria-labelledby="cmr-help-screens">
        <h2 className="cmr-serif cmr-help-h2" id="cmr-help-screens">The screens</h2>
        <div className="cmr-card cmr-help-card cmr-help-screens">
          <div className="cmr-help-screen">
            <h3 className="cmr-serif">Daily ledger <span className="cmr-help-aside">(the home screen)</span></h3>
            <p>
              One day&rsquo;s cash position, with a separate <strong>AM</strong> and <strong>PM</strong> snapshot
              — pick a date and AM or PM at the top. It shows:
            </p>
            <dl className="cmr-help-dl">
              <div>
                <dt>Beginning cash</dt>
                <dd>what the bank showed when the snapshot was taken.</dd>
              </div>
              <div>
                <dt>Adjustments</dt>
                <dd>
                  anything that moves cash up or down (a wire, a deposit, a hold). An adjustment can carry an
                  amber <strong>warning note</strong> (&ldquo;needs to be covered by 2 PM&rdquo;).
                </dd>
              </div>
              <div>
                <dt>Pending in bank</dt>
                <dd>
                  payments that have been written but haven&rsquo;t cleared yet, grouped by account. This total
                  comes <em>off</em> the balance.
                </dd>
              </div>
              <div className="key">
                <dt>Current balance</dt>
                <dd>= beginning cash + adjustments − pending. That&rsquo;s the number to trust.</dd>
              </div>
            </dl>
            <p>
              On a pending payment you can <strong>check it paid</strong>, <strong>push</strong> it to another
              day (it moves forward and leaves today&rsquo;s total; the original stays as a greyed history line),
              or <strong>un-push</strong> it to bring it back.
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">Weekly priorities</h3>
            <p>
              What has to be paid or handled this week, in your order. Flag the important ones as{' '}
              <strong>Top</strong>, mark them <strong>resolved</strong> or <strong>paid</strong>, or{' '}
              <strong>carry</strong> one to a later week. The header shows what&rsquo;s{' '}
              <strong>still needed</strong> (open items only) versus what&rsquo;s already paid or resolved.
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">Recurring <span className="cmr-help-aside">(Vendors → Recurring)</span></h3>
            <p>
              The remembered schedule of regular payments, grouped by{' '}
              <strong>Weekly / Monthly / Quarterly / Annually</strong>, plus <strong>Urgent Payment Plans</strong>.
              Each vendor has a real schedule — a day of the week, a day of the month, or a month-and-day — so the
              system knows exactly when it&rsquo;s due. You can put a vendor <strong>on hold</strong> (it stays on
              the list but stops being suggested) and record the <strong>last amount sent</strong>.
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">Requests <span className="cmr-help-aside">(Vendors → Requests)</span></h3>
            <p>
              The inbox between the team and the Controller. A <strong>Requester</strong> submits a vendor payment
              here. The <strong>Controller</strong> then <strong>places</strong> each one — into a specific
              day&rsquo;s pending list, or a specific week&rsquo;s priorities — or <strong>declines</strong> it. A
              placed request can be <strong>undone</strong> if it was placed by mistake (as long as it hasn&rsquo;t
              been paid or moved on).
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">Weekly rollup</h3>
            <p>
              The whole week at a glance: each day&rsquo;s cash, the week&rsquo;s pending and priorities, recurring
              totals by frequency (with an account filter), and a <strong>&ldquo;Due this week&rdquo;</strong> list
              of recurring vendors that are scheduled but not yet entered. Each has an <strong>Add</strong> button
              — nothing posts on its own; Add opens a short dialog where the Controller chooses where it lands (a
              day&rsquo;s pending, or a week&rsquo;s priority). Once added, it drops off the due list and
              can&rsquo;t be double-entered.
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">
              Settings → Accounts <span className="cmr-help-aside">(Controller only)</span>
            </h3>
            <p>
              The bank accounts everything else is grouped by. Rename or reorder them, and retire one by making it
              inactive (accounts are never deleted, so history stays intact).
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">
              Settings → Access <span className="cmr-help-aside">(Controller only)</span>
            </h3>
            <p>
              Who can open Cash Ledger and what role they have. There&rsquo;s always at least one Controller.
            </p>
          </div>
        </div>
      </section>

      <section className="cmr-sec" aria-labelledby="cmr-help-tasks">
        <h2 className="cmr-serif cmr-help-h2" id="cmr-help-tasks">Common tasks</h2>
        <div className="cmr-card">
          <dl className="cmr-help-tasks">
            <div>
              <dt>Start the day</dt>
              <dd>
                open <strong>Daily ledger</strong>, set the <strong>AM</strong> beginning cash, then add the payments
                that are pending in the bank.
              </dd>
            </div>
            <div>
              <dt>Enter a recurring bill that&rsquo;s due</dt>
              <dd>
                <strong>Weekly rollup → Due this week → Add</strong>, and pick where it goes.
              </dd>
            </div>
            <div>
              <dt>A teammate needs a vendor paid</dt>
              <dd>
                they submit it on <strong>Requests</strong>; the Controller <strong>Places</strong> it into the
                ledger or priorities.
              </dd>
            </div>
            <div>
              <dt>A payment slips to another day</dt>
              <dd>
                <strong>Push</strong> it from the pending list — the balance follows it, and nothing is lost.
              </dd>
            </div>
            <div>
              <dt>Mark something paid</dt>
              <dd>
                use the <strong>paid</strong> checkbox on the pending item or priority.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="cmr-sec" aria-labelledby="cmr-help-know">
        <h2 className="cmr-serif cmr-help-h2" id="cmr-help-know">Good to know</h2>
        <div className="cmr-card cmr-help-card">
          <ul className="cmr-help-list">
            <li>
              <strong>Nothing posts by itself.</strong> Recurring due-payments and requests are always suggestions a
              Controller confirms.
            </li>
            <li>
              <strong>Every change is recorded</strong> — who did it and when.
            </li>
            <li>
              <strong>All dates and times are Pacific</strong>, and every amount is exact to the cent.
            </li>
          </ul>
        </div>
      </section>
    </article>
  )
}
