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
                  decline requests; add recurring due-payments; import each account&rsquo;s A/P and merge
                  vendors; and manage who has access.
                </td>
              </tr>
              <tr>
                <th scope="row"><span className="cmr-pill requester">Requester</span></th>
                <td>
                  See everything, and submit vendor payment requests — built from the account&rsquo;s imported
                  A/P. That&rsquo;s the one thing a Requester changes — everything else is read-only for them.
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
              here, built from that account&rsquo;s imported A/P &mdash; see{' '}
              <strong>Building a request from A/P</strong> below. The{' '}
              <strong>Controller</strong> then <strong>places</strong> each one — into a specific
              day&rsquo;s pending list, or a specific week&rsquo;s priorities — or <strong>declines</strong> it. A
              placed request can be <strong>undone</strong> if it was placed by mistake (as long as it hasn&rsquo;t
              been paid or moved on).
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">
              Accounts Payable <span className="cmr-help-aside">(Vendors → Accounts Payable)</span>
            </h3>
            <p>
              A daily snapshot of what each account owes, taken straight from QuickBooks. A Controller clicks{' '}
              <strong>Import A/P aging</strong>, picks the account and uploads that day&rsquo;s{' '}
              <strong>A/P Aging Detail</strong> spreadsheet. The file is previewed first — including whether it
              reconciles to the report&rsquo;s own TOTAL — and only on confirm does it <strong>replace</strong>{' '}
              that account&rsquo;s snapshot. One import, one account, one current picture; nothing is merged with
              yesterday&rsquo;s.
            </p>
            <p>
              The screen lists vendors with the amount owed, and each one expands to its invoices. Only{' '}
              <strong>Bill</strong> and <strong>Credit</strong> lines are payable, and credits show as negative.
              The rest of the report — journal entries, bill payments, adjustments — is kept so the import adds up
              to the report TOTAL, and is listed separately as never payable.
            </p>
            <p>
              Every role can read this screen. Only a <strong>Controller</strong> can import.
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">
              Building a request from A/P <span className="cmr-help-aside">(Vendors → Requests)</span>
            </h3>
            <p>
              A Requester builds a payment request by picking the <strong>account</strong>, then a{' '}
              <strong>vendor</strong> from that account&rsquo;s current A/P, then <strong>ticking the
              invoices</strong> to pay. Credits are tick-lines of their own and subtract, so the total is worked
              out for them — and worked out again on the server when the request is submitted. One request covers
              one account.
            </p>
            <p>
              Typing a vendor and amount by hand is gone for Requesters. A <strong>Controller</strong> can still
              switch the form to <strong>Enter by hand</strong> — which is what to do for an account whose A/P
              hasn&rsquo;t been imported yet.
            </p>
            <p>
              The ticked invoices are <strong>saved onto the request</strong>, so the next day&rsquo;s import
              can&rsquo;t erase what it was built from. An invoice that has since been paid or dropped only adds a
              hint on the request.
            </p>
          </div>

          <div className="cmr-help-screen">
            <h3 className="cmr-serif">Vendors <span className="cmr-help-aside">(Vendors → Vendors)</span></h3>
            <p>
              Every vendor owed across all the accounts: the total, then each account&rsquo;s share and its
              invoices. Owed is every open Bill less every open Credit.
            </p>
            <p>
              A vendor spelled <em>identically</em> in QuickBooks under several accounts is automatically one
              vendor here. Differently-spelled ones stay separate until a Controller merges them — nothing merges
              on its own.
            </p>
            <p>
              A <strong>Controller</strong> can <strong>Merge</strong> two vendors, <strong>Split</strong> one back
              apart, <strong>Rename</strong> the name shown here, and work through{' '}
              <strong>Possible duplicates</strong>, the pairs the system suggests (with an optional{' '}
              <strong>Ask AI to review</strong>). A merge keeps every QuickBooks spelling of both sides, so it
              survives the daily imports — and Split separates them again.
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
              <dt>Refresh what the accounts owe</dt>
              <dd>
                <strong>Accounts Payable → Import A/P aging</strong>, pick the account and upload that
                day&rsquo;s A/P Aging Detail — it replaces that account&rsquo;s snapshot.
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
