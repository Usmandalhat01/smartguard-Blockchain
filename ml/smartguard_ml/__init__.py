"""SmartGuard machine-learning pipeline.

Every stage writes its output to disk and every later stage reads that output
rather than recomputing. The purpose is that the confusion matrix, the
classification report and the comparison table cannot disagree: they are all
derived from one saved set of predictions against one saved split.
"""

__version__ = "1.0.0"
