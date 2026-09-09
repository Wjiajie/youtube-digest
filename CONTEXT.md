# Blueprint Domain

Blueprint models a user's intended personal change as a reviewable path. The language below is shared by the Web application, browser extension, Agent workflows, and persistence model.

## Language

**Blueprint**:
The single user-owned map that contains all of the user's goals and their paths.
_Avoid_: Workspace, project collection

**Goal**:
A longer-term outcome the user intends to reach.
_Avoid_: Task, project

**Goal Brief**:
A user's definition of an intended outcome, starting point, available time, constraints, and success criteria before path planning. Confirming this definition is distinct from confirming a Blueprint Proposal.
_Avoid_: Formal Goal, saved path, Agent plan

**Stage**:
An ordered grouping that makes a goal path understandable in parts; it is not evidence that an outcome has been reached.
_Avoid_: Milestone

**Path Node**:
A concrete step on a goal path, classified as learning, practice, checkpoint, or reflection.
_Avoid_: Learning node, task

**Resource Binding**:
An optional association between a path node and an external resource such as a YouTube video.
_Avoid_: Node content, required video

**Blueprint Proposal**:
A complete suggested Blueprint state based on a known revision that has not changed the user's Blueprint.
_Avoid_: Saved plan, Agent result

**Blueprint Revision**:
An immutable record of a Blueprint state that became official after the user confirmed a proposal.
_Avoid_: Draft, autosave

**Learning Session**:
A user-initiated period of learning associated with a path node and, optionally, a resource binding.
_Avoid_: Page view, watch event

**Product Event**:
A content-free record of a meaningful product action or operational result.
_Avoid_: User evidence, activity content

**Progress Evidence**:
A user-owned record of learning, practice, checkpoint, or reflection outcomes associated with a path node; it supports the user's assessment of progress without itself proving mastery.
_Avoid_: Product Event, mastery certificate

**Node Status Confirmation**:
A user's explicit assessment that a path node is not started, in progress, or completed against its stated completion criteria. It may cite Progress Evidence, but remains a self-assessment rather than proof of mastery.
_Avoid_: Automatic completion, mastery certificate, Blueprint Proposal

**Theme**:
A coherent visual and expressive treatment of the user's Blueprint experience across the home, goals, and learning surfaces, without changing the meaning of their goals, progress, or decisions.
_Avoid_: Color preset, separate product

**Avatar**:
The user's virtual representation within their Blueprint; different themes can give it different appearances while preserving the same personal identity, goals, and achievements.
_Avoid_: Agent, goal, player account
