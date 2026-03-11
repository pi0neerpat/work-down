# Hub — Task Tracker

## Dashboard
- [x] Add checkpoint/revertibility support via git branches
- [x] Add inter-agent communication support
- [x] Add decision log timeline view
- [ ] - Add a session usage meter in the top showing progress bar and percentage for current claude code session usage.  Heres what is shown on my claude dashboard: Current session  Resets in 2 hr 3 min  61% used
- [x] Organize worker bees under each respective repo they serve, rather than in one place
- [ ] Allow starting a new worker manually in a repo using a "Start worker" button immediately below each repo. This essentially starts a new worker, enters the /swarm and waits for the user to complete the message
- [ ] Add the following to the hub.config for each repo: start script, test script, cleanup script.
- [x] Cannot scroll in terminal view, it always brings me back to the top. Likely some issue with claude interactive mode and our setup.
- [x] once started, a todo item check box should become an indicator that the task is in progress, and not allow me to edit it, change its status or start a new session. I should instead be presented with a way to open the bee currently performing that task
- [x] agents shouldnt be organized into the done dropdown until they are validated. They should remain visible, with a "Needs validation" flag so I know they are ready for my input. please resume the existing session for this
- [x] I no longer see the terminal when clicking on a bee. I just see "No terminal for this worker."
- [ ] The flow for a manually started worker should be updated. The title of the session should be manageable. The sessions shouldn't automatically disappear from the running tasks. And the calaude startup command should not be randomely inserted into the input when navigating back to the session
- [ ] Make the running indicator animation much more chill. Maybe slow it down a bit?
- [ ] Make each item in the todo lists a card, so that when clicking to modify the text, we can modify multi-line rather than changing to single line text input
- [ ] Editing items in the marketing todo list doesn't work properly. maybe because there are multiple sections? Also, the first section "Outreach" doesnt seem to appear in the todo list at all. Lets make this todo parsing/editing more robust
- [ ] the mark todo as done feature doesnt work properly, because the title of the item is updated during the swarm process. We need to persist the original todo text so that we can properly close the correct todo after validation
- [ ] tasks with rejected status should be able to be restarted in the task view. Their indicator should change to a red x for failed

