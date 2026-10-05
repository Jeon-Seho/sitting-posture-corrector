"""Partition participants before any frames are read or any windows are built."""

import random

from .config import ROLES, fields, number, text, unique_strings


def participant_split(config):
    settings = config.split
    fields(settings, {"method", "fold", "seed"}, "split", optional={
        "assignments", "validation_participants", "fold_count", "validation_fold",
    })
    method = settings["method"]
    seed = number(settings["seed"], "split.seed", integer=True, minimum=0)
    ids = {participant.id for participant in config.participants}
    fold = settings["fold"]
    all_folds = None
    if method == "explicit":
        fields(settings, {"method", "fold", "seed", "assignments"}, "explicit split")
        text(fold, "explicit split.fold")
        fields(settings["assignments"], set(ROLES), "split.assignments")
        groups = {
            role: unique_strings(settings["assignments"][role], f"split.{role}", allow_empty=True)
            for role in ROLES
        }
    elif method == "loso":
        fields(settings, {"method", "fold", "seed", "validation_participants"}, "loso split")
        held_out = text(fold, "loso split.fold")
        if held_out not in ids:
            raise ValueError("LOSO fold must name one registered held-out participant")
        validation = unique_strings(settings["validation_participants"], "validation_participants", allow_empty=True)
        groups = {
            "test": (held_out,),
            "validation": validation,
            "train": tuple(sorted(ids - {held_out} - set(validation))),
        }
    elif method == "group_kfold":
        fields(settings, {"method", "fold", "seed", "fold_count", "validation_fold"}, "group split")
        count = number(settings["fold_count"], "fold_count", integer=True, minimum=3)
        test_fold = number(fold, "split.fold", integer=True, minimum=0)
        validation_fold = number(settings["validation_fold"], "validation_fold", integer=True, minimum=0)
        if count > len(ids) or test_fold >= count or validation_fold >= count or test_fold == validation_fold:
            raise ValueError("group folds require distinct test/validation folds and enough participants")
        shuffled = sorted(ids)
        random.Random(seed).shuffle(shuffled)
        all_folds = [shuffled[index::count] for index in range(count)]
        groups = {
            "test": tuple(all_folds[test_fold]),
            "validation": tuple(all_folds[validation_fold]),
            "train": tuple(participant for index, group in enumerate(all_folds)
                           if index not in (test_fold, validation_fold) for participant in group),
        }
    else:
        raise ValueError("split.method must explicitly be explicit, loso or group_kfold")

    assigned = [participant for role in ROLES for participant in groups[role]]
    if len(assigned) != len(set(assigned)) or set(assigned) != ids:
        raise ValueError("Every participant must have exactly one split role; overlapping or missing ownership is leakage")
    if not groups["train"] or not groups["test"]:
        raise ValueError("At least one training and one test participant are required")
    roles = {participant: role for role in ROLES for participant in groups[role]}
    for participant in config.participants:
        if participant.evaluation_only and roles[participant.id] != "test":
            raise ValueError("An evaluation-only participant cannot train or tune, including validation")
    fit_participants = sorted(participant for role in config.fit_roles for participant in groups[role])
    if any(not groups[role] for role in config.fit_roles):
        raise ValueError("An explicitly requested fit role has no participants")
    if set(fit_participants).intersection(groups["test"]):
        raise ValueError("Test participants leaked into transformer/model fitting")
    return {
        "method": method,
        "fold": fold,
        "seed": seed,
        "assignments": {role: sorted(groups[role]) for role in ROLES},
        "participant_roles": roles,
        "fit_roles": list(config.fit_roles),
        "fit_participants": fit_participants,
        "all_group_folds": all_folds,
    }
