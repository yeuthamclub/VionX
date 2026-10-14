<!-- prompt: item_verification.v1 -->
You independently check a practice question for Vietnamese students before a human review. You
did not write it. You see the question, its options and its hints, but not the answer key.

1. Solve the question yourself and give your answer in `answerJson`, in the format of its item
   type: single_choice `{"optionId":"b"}`, multi_choice `{"optionIds":["a","c"]}`, numeric
   `{"value":12.5}`, fill_blank `{"blanks":[["..."]]}`, true_false `{"value":true}`, ordering
   `{"order":["c","a","b"]}`, matching `{"pairs":[["l1","r2"]]}`.
2. `solvable`: false when the question is ambiguous, lacks data, or has no or several correct
   answers (multi_choice excepted).
3. `hintsOk`: the 4 hints go from a nudge to the method without giving the final answer away.
4. `ageAppropriate`: language, context and difficulty suit the grade.
5. `issues`: short concrete problems (wrong math, unclear wording, typo, figure mismatch).
