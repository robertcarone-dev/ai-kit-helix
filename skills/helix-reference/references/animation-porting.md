# Port editable animation to Unity

Use this contract for authorized animation implementation, together with the [motion comparison skill](../../helix-compare-motion/SKILL.md), [port recipe](port-recipe.md), and the consuming project's authoring rules. It describes reusable requirements, not a ready-made rig or controller. Keep game-specific timings, assets, scripts, and evidence in the consuming project.

## Establish the source contract

Read the running variant's motion code and its callers. Callers can override generic durations, delays, amplitudes, and scheduling. Record:

- Trigger, initial pose, phase boundaries, cues, final pose, and supported restart/interruption behavior.
- Clock origin, units, scaled/unscaled time, delta limits, loops, and independent continuous phases.
- Axes, angle units, rotation order, pivots, parent scale, and the transform that controls the visible model.
- Every property writer, its evaluation order, and whether overlapping contributions replace, add, multiply, or blend.

Source JavaScript being procedural does not make a fixed trajectory dynamic. Distinguish repeatable authored motion from motion whose result depends on input, navigation, camera position, randomness, physics, or accumulated spring/simulation state.

## Author sparse curves from the source

Fixed entrances, anticipation, holds, recoil, hops, flips, rebounds, settlement, and repeatable continuous motion belong in editable clips. Keep genuinely state-dependent motion procedural. Composing fixed clip channels with dynamic contributions is runtime integration, not a reason to recalculate the fixed trajectory in code.

Do not deliver one key per rendered frame, a uniform frame-rate bake, or dense samples as the final asset. Dense observations can be fitting inputs. If a source cannot reasonably be represented sparsely, document the specific limitation and leave editability unresolved rather than silently accepting a dense bake.

Place keys at meaningful phase boundaries and extrema. Tune incoming/outgoing tangents to preserve velocity, easing, overshoot, and settlement. Use exact cubic/Hermite representations where possible; add intermediate keys only when curve complexity requires them. There is no universal key-count cap.

Preserve actual discontinuities with stepped boundaries rather than smoothing them across a frame. Inspect both sides of each boundary: floating-point conversion in an offline fitter can evaluate the wrong branch and create a cluster of unnecessary keys. Explain closely spaced keys. Keep holds flat, preserve value/velocity continuity where the source is continuous, and retain full-turn winding and intended rotation direction.

Fit against source formulas or live observations. Simplifying an old Unity bake only proves closeness to that bake. Report authored key counts, bindings, durations, comparison basis, and interpolation error. Distinguish authored scalar curves from Unity's runtime vector-key unions and duplicated editor serialization. Label sampled maximum errors as sampled, not mathematical bounds.

## Keep clocks and ownership explicit

Give each reusable contribution one authoritative curve and each final transform property one writer. Direct Transform bindings suit properties exclusively owned by the Animator. For mixed ownership, use the project's existing composition path or explicit clip-authored scalar channels and one final composer. Document units; do not let Animator sampling and Update/LateUpdate compete over the same property.

Use the owning presentation clock for all layers and cues of the same event. Match source delta limits and scaled/unscaled time. Reset event time when the event restarts, without resetting unrelated continuous motion. Fixed motions with different periods need independent clip phases on the shared clock; baking their first iteration into the event loop resets them incorrectly at the seam.

History-dependent color response, eye springs, random particles, and movement-dependent waddle can remain procedural. Fixed effort or blend envelopes can still be authored channels. Particle emission beats must follow the event clock even when particle trajectories are dynamic. Preserve acquisition, reset, disable/re-enable, and cleanup behavior at the owner's lifetime boundary.

When navigation or another explicit state machine owns action timing, do not leave a competing Animator clock. Use the project's established sampling mechanism. Audit autonomous transitions, triggers, speed/time parameter bindings, and parameter-name constants. Remove obsolete ones after checking callers and serialized references; clear a state's active parameter binding before deleting the parameter. A parameter-free state/clip catalog is appropriate for explicitly sampled states, but is not a rule for controllers that legitimately own timing.

## Preserve overlap and transitions

Starting a secondary event must not terminate an entrance unless the source does so. Compose against the current underlying pose, including its landing and settlement. A frozen snapshot or neutral-pose crossfade cannot represent a still-running contribution. Author fixed blend-weight envelopes rather than baking a particular overlap offset into a variant-specific clip.

Preserve precedence: one phase may retain underlying squash while another replaces lift. Additive offsets, multiplicative squash, parent scale, and dynamic accents are different operations. Check both sides of handoffs and event boundaries. Keep cues at their owning boundary and fire once per accepted event; do not shift cues to hide incorrect animation timing. Completing, interrupting, and canceling an event may have different scheduling consequences.

## Support visible Edit Mode preview

Clips must preview and scrub visibly in Unity's Animation window without Play Mode. Component-property curves that only change Inspector values are incomplete authoring support.

Use direct Transform curves where sufficient. For custom composition, use the supported preview hook for the project's actual Unity version and evaluate sampled properties at the correct graph stage. An animation job can compose after sampling; a callback before sampling cannot read the new pose. Keep Editor integration out of player assemblies. Do not copy another project's adapter without checking its rig, ownership, and lifecycle.

Preview must not advance gameplay clocks, cues, randomness, or dynamic simulation. Register every modified property with Unity's preview restoration mechanism and retain original values and prefab-override state. Cache rest values before sampling, not from an already previewed pose when rebuilding the graph. For an isolated amplitude-modulated contribution, document its preview context instead of silently substituting runtime behavior.

Observe forward and backward scrubbing, phase boundaries, clip switching, and preview exit. Confirm intentional overrides restore. Account for the Animation window's frame-grid quantization separately from runtime action time. Inspect final cleanup after any selection/time reset: changing window time after stopping preview can reactivate it. Release owned graphs, textures, callbacks, objects, and temporary scenes at the matching lifetime boundary.

## Retire obsolete authoring paths

Inspect actual references before treating an old clip as a live example. When retirement is in scope, check asset GUIDs, paths/names, runtime loading, controllers, prefabs, tools, and constants. Remove obsolete clips with their metadata and unused controller states/parameters as appropriate. Preserve active asset GUIDs and wire all required authoring references. Use supported Unity asset/controller APIs when available.

Update the consuming project's guide with the active clip/controller/component mapping and dynamic owners. Mark historical measurements as historical. Do not leave an unused bake presented as the template for future agents, or delete an apparently unused source without establishing its ownership and authorized scope.

## Verify and report

Follow the consuming repository's verification policy. For instruction-only updates, inspect links and installer discovery; no live Unity session is required. For motion implementation, use appropriate compilation and serialized/caller inspection plus live source/Unity observations and an Animation-window walkthrough. Do not substitute synthetic checks or source-formula agreement for observing the running implementation.

Include relevant entrance/settlement, action-from-rest, actual overlap, loop seam and second loop, restart/interruption, disable/re-enable, and preview restoration cases. Use named reproducible scenarios and capture before the trigger. Align with observed events and animation-clock markers, not file start or fixture readiness. Distinguish game time, wall time, video time, missed frames, and frame-quantization uncertainty.

Record dependency hashes when capturing, preserve original receipts/frames, and recheck affected cases after changed inputs. Do not relabel closeout hashes as capture-time provenance. Inspect rendered motion as well as traces. Offscreen fixtures do not establish final UI layout, occlusion, cold-start performance, random trajectory identity, or normal-input behavior; keep those claims unmeasured unless separately observed.

Report implementation, measured motion, remaining gaps, integration, and cleanup separately. For requested commits, review all task-owned clips, metadata, controllers, prefab wiring, runtime/Editor code, guides, and maintained capture tools together. Inspect remaining changes before assigning ownership; do not assume dirty files belong to another agent. Exclude unrelated work only on evidence and report what remains uncommitted.
