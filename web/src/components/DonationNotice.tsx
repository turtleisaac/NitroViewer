import { useState } from "react";
import {
  DONATION_DETAIL,
  DONATION_MESSAGE,
  dismissDonationNotice,
  donationDismissed,
  shouldShowDonationNotice,
} from "../donationNotice";

export function DonationNotice(props: { referrer?: string; storage?: Storage }) {
  const referrer = props.referrer ?? document.referrer;
  const storage = props.storage ?? window.localStorage;
  const [hideForever, setHideForever] = useState(false);
  const [open, setOpen] = useState(() => shouldShowDonationNotice(referrer, donationDismissed(storage)));

  if (!open) return null;

  return (
    <div className="notice-scrim">
      <div className="notice" role="dialog" aria-modal="true" aria-labelledby="donation-notice-title">
        <h2 id="donation-notice-title">NitroViewer</h2>
        <p>{DONATION_MESSAGE}</p>
        <p>{DONATION_DETAIL}</p>
        <label className="notice-check">
          <input type="checkbox" checked={hideForever} onChange={(event) => setHideForever(event.target.checked)} />
          {"Don't show this again"}
        </label>
        <div className="notice-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => dismissDonationNotice(hideForever, storage, () => setOpen(false))}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
