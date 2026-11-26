import base64
import json
import os
import plistlib
import re
import shutil
import urllib.request

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
INDEX_HTML = os.path.join(REPO_ROOT, "index.html")
REPO_SHORTCUT_OUT = os.path.join(REPO_ROOT, "Sync-Apple-Health.shortcut")
THEO_ASSETS_DIR = os.path.abspath(os.path.join(REPO_ROOT, "..", "theo", "assets"))
THEO_SHORTCUT_OUT = os.path.join(THEO_ASSETS_DIR, "Sync-Apple-Health.shortcut")

CLOUD_URL = "https://theo-edge-relay.husseinbdeir.workers.dev/store/fitness"
ORIGIN_URL = "https://fitness.husseinbdeir.workers.dev"


def read_cloud_key():
    html = open(INDEX_HTML, "r", encoding="utf-8").read()
    m = re.search(r'_CLOUD_CFG\s*=\s*\{[^}]*?k\s*:\s*"([A-Za-z0-9+/=]+)"', html)
    if not m:
        raise RuntimeError("Could not locate _CLOUD_CFG.k in fitness/index.html")
    return base64.b64decode(m.group(1)).decode("utf-8").strip()


def comment_action(text):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.comment",
        "WFWorkflowActionParameters": {"WFCommentActionText": text},
    }


def find_health(sample_type, u, group_by_day=False, unit=None):
    params = {
        "UUID": u,
        "WFContentItemFilter": {
            "Value": {
                "WFActionParameterFilterPrefix": 1,
                "WFContentPredicateBoundedDate": False,
                "WFActionParameterFilterTemplates": [
                    {
                        "Bounded": True,
                        "Operator": 4,
                        "Property": "Type",
                        "Removable": False,
                        "Values": {
                            "Enumeration": {
                                "Value": sample_type,
                                "WFSerializationType": "WFStringSubstitutableState",
                            }
                        },
                    },
                    {
                        "Bounded": True,
                        "Operator": 1002,
                        "Property": "Start Date",
                        "Removable": False,
                        "Values": {
                            "Number": {
                                "Value": "1",
                                "WFSerializationType": "WFNumberStringSubstitutableState",
                            },
                            "Unit": {
                                "Value": 16,
                                "WFSerializationType": "WFCalendarUnitSubstitutableState",
                            },
                        },
                    },
                ],
            },
            "WFSerializationType": "WFContentPredicateTableTemplate",
        },
        "WFHKSampleFilteringFillMissing": False,
    }
    if group_by_day:
        params["WFHKSampleFilteringGroupBy"] = "Day"
    if unit:
        params["WFHKSampleFilteringUnit"] = unit
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.filter.health.quantity",
        "WFWorkflowActionParameters": params,
    }


def get_health_values(filter_uuid, u):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.properties.health.quantity",
        "WFWorkflowActionParameters": {
            "UUID": u,
            "WFContentItemPropertyName": "Value",
            "WFInput": {
                "Value": {
                    "OutputName": "Health Samples",
                    "OutputUUID": filter_uuid,
                    "Type": "ActionOutput",
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }


def calc_stat(op, val_uuid, u):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.statistics",
        "WFWorkflowActionParameters": {
            "UUID": u,
            "WFStatisticsOperation": op,
            "Input": {
                "Value": {
                    "OutputName": "Value",
                    "OutputUUID": val_uuid,
                    "Type": "ActionOutput",
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }


def token_str(template, var_list):
    ph = "\ufffc"
    atts = {}
    idx = 0
    for vu, vname in var_list:
        pos = template.index(ph, idx)
        atts[f"{{{pos}, 1}}"] = {
            "OutputUUID": vu,
            "OutputName": vname,
            "Type": "ActionOutput",
        }
        idx = pos + 1
    return {
        "Value": {"string": template, "attachmentsByRange": atts},
        "WFSerializationType": "WFTextTokenString",
    }


def format_current_date(fmt_str, u):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
        "WFWorkflowActionParameters": {
            "UUID": u,
            "WFDate": {
                "Value": {
                    "string": "\ufffc",
                    "attachmentsByRange": {"{0, 1}": {"Type": "CurrentDate"}},
                },
                "WFSerializationType": "WFTextTokenString",
            },
            "WFDateFormatStyle": "Custom",
            "WFDateFormat": "Custom",
            "WFDateFormatString": fmt_str,
        },
    }


def main():
    cloud_key = read_cloud_key()
    u_date_iso = "A11E2B10-3C9A-4D71-9E52-1A6C8B0D4F91"
    u_sync_iso = "B22E2B10-3C9A-4D71-9E52-1A6C8B0D4F92"
    u_steps = "8F4E2B10-3C9A-4D71-9E52-1A6C8B0D4F21"
    u_steps_val = "8F4E2B10-3C9A-4D71-9E52-1A6C8B0D4F31"
    u_steps_sum = "4C7A9E12-6B3D-4F80-8A15-2E9D7C5B3A02"
    u_kcal = "D29B5E41-7A1C-4E63-B824-9F0C3D6A1E03"
    u_kcal_val = "D29B5E41-7A1C-4E63-B824-9F0C3D6A1E33"
    u_kcal_sum = "6E1F8C34-9D2B-4A57-8C61-5B4E2F9A7D04"
    u_dist = "A38C4D29-1E5F-4B92-9D73-8C2A6E1F4B05"
    u_dist_val = "A38C4D29-1E5F-4B92-9D73-8C2A6E1F4B35"
    u_dist_sum = "5B9D1E63-4C8A-4F21-A739-1D5C8B3E9A06"
    u_json_txt = "B64E1D92-3A7C-4F58-9E21-6D8B4C3A2F13"
    u_post = "1C9A7E45-8B2D-4E63-A519-7F3D8B6C4E14"
    u_url = "7D3C9B51-4A8E-4F62-9E18-5A3C7D9B2E11"
    u_open = "E15A8D46-9B2C-4E73-8C59-4F6A1B8D3C12"

    ph = "\ufffc"
    json_vars_list = [
        (u_date_iso, "Formatted Date"),
        (u_sync_iso, "Formatted Date"),
        (u_steps_sum, "Sum"),
        (u_kcal_sum, "Sum"),
        (u_dist_sum, "Sum"),
    ]
    url_vars_list = [
        (u_date_iso, "Formatted Date"),
        (u_steps_sum, "Sum"),
        (u_kcal_sum, "Sum"),
        (u_dist_sum, "Sum"),
    ]
    json_template = (
        '{"key":"'
        + cloud_key
        + '","op":"patch","patch":{"profiles/hussein/health/latest":{'
        + f'"date":"{ph}","syncedAt":"{ph}","steps":"{ph}","activeKcal":"{ph}","distanceKm":"{ph}","source":"Apple Health Shortcut"'
        + "}}}"
    )
    url_template = f"{ORIGIN_URL}/?health_sync=1&date={ph}&steps={ph}&active_kcal={ph}&distance_km={ph}"

    wf = {
        "WFWorkflowClientVersion": "2700.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4282601983,
            "WFWorkflowIconGlyphNumber": 59722,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowTypes": ["NCWidget", "Watch"],
        "WFWorkflowActions": [
            comment_action(
                "Sync Apple Health: reads today's exact Steps, Active Energy, and Walking + Running Distance from Apple Health and syncs them to Upper Body Programme."
            ),
            format_current_date("yyyy-MM-dd", u_date_iso),
            format_current_date("yyyy-MM-dd'T'HH:mm:ssXXXXX", u_sync_iso),
            find_health("Steps", u_steps, group_by_day=True),
            get_health_values(u_steps, u_steps_val),
            calc_stat("Sum", u_steps_val, u_steps_sum),
            find_health("Active Energy", u_kcal, group_by_day=True, unit="kcal"),
            get_health_values(u_kcal, u_kcal_val),
            calc_stat("Sum", u_kcal_val, u_kcal_sum),
            find_health("Walking + Running Distance", u_dist, group_by_day=True, unit="km"),
            get_health_values(u_dist, u_dist_val),
            calc_stat("Sum", u_dist_val, u_dist_sum),
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
                "WFWorkflowActionParameters": {
                    "UUID": u_json_txt,
                    "WFTextActionText": token_str(json_template, json_vars_list),
                },
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "UUID": u_post,
                    "WFURL": CLOUD_URL,
                    "WFHTTPMethod": "POST",
                    "WFHTTPBodyType": "File",
                    "WFHTTPHeaders": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                {
                                    "WFItemType": 0,
                                    "WFKey": {
                                        "Value": {"string": "Content-Type"},
                                        "WFSerializationType": "WFTextTokenString",
                                    },
                                    "WFValue": {
                                        "Value": {
                                            "string": "text/plain;charset=UTF-8"
                                        },
                                        "WFSerializationType": "WFTextTokenString",
                                    },
                                }
                            ]
                        },
                        "WFSerializationType": "WFDictionaryFieldValue",
                    },
                    "WFRequestVariable": {
                        "Value": {
                            "OutputName": "Text",
                            "OutputUUID": u_json_txt,
                            "Type": "ActionOutput",
                        },
                        "WFSerializationType": "WFTextTokenAttachment",
                    },
                },
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.url",
                "WFWorkflowActionParameters": {
                    "UUID": u_url,
                    "WFURLActionURL": token_str(url_template, url_vars_list),
                },
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
                "WFWorkflowActionParameters": {
                    "UUID": u_open,
                    "WFInput": {
                        "Value": {
                            "OutputName": "URL",
                            "OutputUUID": u_url,
                            "Type": "ActionOutput",
                        },
                        "WFSerializationType": "WFTextTokenAttachment",
                    },
                },
            },
        ],
    }

    xml_bytes = plistlib.dumps(wf, fmt=plistlib.FMT_XML)
    assert CLOUD_URL.encode("utf-8") in xml_bytes
    assert f"{ORIGIN_URL}/?health_sync=1".encode("utf-8") in xml_bytes

    req = urllib.request.Request(
        "https://hubsign.routinehub.services/sign",
        data=json.dumps(
            {
                "shortcutName": "Sync Apple Health",
                "shortcut": xml_bytes.decode("utf-8"),
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "cherri/1.0"},
    )
    signed = urllib.request.urlopen(req, timeout=30).read()
    assert signed[:4] == b"AEA1", f"Unexpected header: {signed[:4]}"
    with open(REPO_SHORTCUT_OUT, "wb") as f:
        f.write(signed)
    os.makedirs(THEO_ASSETS_DIR, exist_ok=True)
    shutil.copyfile(REPO_SHORTCUT_OUT, THEO_SHORTCUT_OUT)
    print(
        f"Signed shortcut OK ({len(signed)} bytes, AEA1) -> {REPO_SHORTCUT_OUT} and {THEO_SHORTCUT_OUT}"
    )


if __name__ == "__main__":
    main()
