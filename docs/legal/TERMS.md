# Terms and conditions

**Last verified: 2026-08-11.**

**project-atlas is a hobby project. It is given away, it is not sold, nobody is paid to keep it working, and
nobody carries liability for what it does on your machine.** Installing it or running it means you accept
that.

These terms are the owner's position stated in plain language. They are not legal advice, they were not
drafted by a lawyer, and the section [What a lawyer would still have to answer](#what-a-lawyer-would-still-have-to-answer)
says exactly which questions they leave open rather than pretending there are none.

---

## Who this covers

**Rajneesh Maurya**, any company related to or associated with him, and **every contributor** to this
repository. All of them are covered by the same disclaimer, on the same terms. A contributor who fixes a typo
takes on no more liability than the owner does, which is none.

## What this software is

**A hobby project, non-commercial.** It is not a product. There is no company behind it, no support contract,
no service-level agreement, no roadmap anyone is entitled to, and no promise that the next version will keep
doing what this one does.

**"Non-commercial" describes the project, not a restriction on you.** The licence is MIT, and MIT permits
commercial use. Nothing here withdraws that — see [Relationship to the MIT licence](#relationship-to-the-mit-licence)
below. What it means is that this side of it is not a business: no revenue, no obligation, no recourse.

## No warranty

The software is provided **as is**, with no warranty of any kind — express or implied — including but not
limited to merchantability, fitness for a particular purpose, and non-infringement.

It is not warranted to be correct, complete, current, secure, or available. It is not warranted to work on
your repository, with your git version, on your operating system, or with your agent runtime.

## No liability

**To the fullest extent permitted by law, the owner, any related or respective companies, and every
contributor are not liable — legally or morally — for anything arising out of the use of this software.**

That includes, without limiting it: damaged, deleted or overwritten files; a documentation site published
somewhere you did not intend; content pushed to a wiki, a Pages branch or an artifact; a rot report that
missed a real defect; a rot report that flagged something correct; time lost; and any direct, indirect,
incidental, special, consequential or exemplary loss.

## Use it with your own best knowledge

**You are responsible for what you run and for what you publish.** The tool has three commands that reach
outward — `atlas publish --push`, and the two named network calls documented in
[PRIVACY.md](PRIVACY.md) — and each of them says what it is doing before it does it. Read that page, read
[`SECURITY.md`](../../SECURITY.md), and check `atlas scan` output before the first publish. What the tool
stages is what the tool was told to stage; deciding whether it should go out is yours.

## Acceptance

**By installing or using this plugin you accept these terms.** There is no click-through and no signature.
If you do not accept them, do not install it, and uninstall it if you already have.

## Relationship to the MIT licence

**The licence is MIT. See [`LICENSE`](../../LICENSE).** MIT is the grant: it is what gives you the right to
use, copy, modify and redistribute the code, and it already carries its own warranty and liability
disclaimer.

**These terms sit alongside that grant, not over it.** They do not add a condition to the licence, do not
restrict any permission MIT gives you, and do not create a second, stricter licence. They restate the owner's
position in language a reader can act on, and cover the operational ground — publishing, network calls, the
accuracy of reports — that a copyright licence does not speak to.

**Where the two appear to conflict, `LICENSE` governs.** A licence is the enforceable instrument; this page is
a statement of intent.

---

## What a lawyer would still have to answer

**This section deliberately writes questions and no answers.** It is the same posture `atlas design --scaffold`
takes with a design document it has no substance for — see `scripts/lib/scaffold.mjs:127`, which prints
"it exists so the questions are written down; the answers are not". A page asserting worldwide compliance
would be exactly the confident-looking unreviewed prose this project refuses everywhere else.

**One factual, non-advisory statement belongs here and is not a question: liability disclaimers are not
enforceable to the same extent in every jurisdiction.** Some limit or void exclusions for death, personal
injury, fraud, gross negligence, or consumer contracts. So the sections above state the owner's *intent*.
They do not guarantee an outcome in any particular forum.

Questions that would have to be answered for a given jurisdiction, and that **nobody here has answered**:

1. Which law governs, and which forum hears a dispute? Nothing above chooses either.
2. Are the warranty and liability exclusions enforceable there, in full or in part? Which carve-outs are
   mandatory?
3. Does distributing free software to a person who is not a customer create a consumer relationship there,
   and does that change the answer to (2)?
4. Is the acceptance mechanism above — installation as assent, with no click-through — sufficient to form a
   contract there?
5. Do any data-protection obligations attach to the data described in [PRIVACY.md](PRIVACY.md), given that it
   is processed locally and never transmitted? Who would be the controller if they did?
6. Do export-control or sanctions rules apply to distributing or downloading this code where you are?
7. Does the MIT grant plus this page create an ambiguity a court would resolve against the drafter?

**If you need any of those answered, ask a lawyer in that jurisdiction.** This project cannot answer them and
will not pretend to.

---

## Related

- [PRIVACY.md](PRIVACY.md) — what the tool reads, writes and transmits, verified against the code.
- [DISCLAIMER.md](DISCLAIMER.md) — what the reports do and do not mean.
- [THIRD-PARTY.md](THIRD-PARTY.md) — the dependency position.
- [`LICENSE`](../../LICENSE) — the MIT grant itself.
- [`SECURITY.md`](../../SECURITY.md) — how to report a vulnerability.
