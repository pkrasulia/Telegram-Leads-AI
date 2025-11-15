# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Callback functions for Telegram Assistant Agent."""

import logging
import time
import json

from google.adk.agents.callback_context import CallbackContext
from google.adk.models import LlmRequest
from typing import Any, Dict, Optional, Tuple
from google.adk.tools import BaseTool
from google.adk.agents.invocation_context import InvocationContext
from google.adk.sessions.state import State
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

RATE_LIMIT_SECS = 60
RPM_QUOTA = 10


def rate_limit_callback(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Callback function that implements a query rate limit.

    Args:
      callback_context: A CallbackContext obj representing the active callback
        context.
      llm_request: A LlmRequest obj representing the active LLM request.
    """
    for content in llm_request.contents:
        for part in content.parts:
            if part.text=="":
                part.text=" "

    now = time.time()
    if "timer_start" not in callback_context.state:
        callback_context.state["timer_start"] = now
        callback_context.state["request_count"] = 1
        logger.debug(
            "rate_limit_callback [timestamp: %i, "
            "req_count: 1, elapsed_secs: 0]",
            now,
        )
        return

    request_count = callback_context.state["request_count"] + 1
    elapsed_secs = now - callback_context.state["timer_start"]
    logger.debug(
        "rate_limit_callback [timestamp: %i, request_count: %i,"
        " elapsed_secs: %i]",
        now,
        request_count,
        elapsed_secs,
    )

    if request_count > RPM_QUOTA:
        delay = RATE_LIMIT_SECS - elapsed_secs + 1
        if delay > 0:
            logger.debug("Sleeping for %i seconds", delay)
            time.sleep(delay)
        callback_context.state["timer_start"] = now
        callback_context.state["request_count"] = 1
    else:
        callback_context.state["request_count"] = request_count

    return

def validate_customer_id(customer_id: str, session_state: State) -> Tuple[bool, str]:
    """
        Validates the customer ID against the customer profile in the session state.
        
        Args:
            customer_id (str): The ID of the customer to validate.
            session_state (State): The session state containing the customer profile.
        
        Returns:
            A tuple containing an bool (True/False) and a String. 
            When False, a string with the error message to pass to the model for deciding
            what actions to take to remediate.
    """
    if 'customer_profile' not in session_state:
        return False, "No customer profile selected. Please select a profile."

    try:
        # Parse the customer profile from JSON stored in state
        customer_data = json.loads(session_state['customer_profile'])
        stored_customer_id = customer_data.get('customer_id')
        
        if customer_id == stored_customer_id:
            return True, ""
        else:
            return False, f"You cannot use the tool with customer_id {customer_id}, only for {stored_customer_id}."
    except (json.JSONDecodeError, KeyError) as e:
        return False, "Customer profile couldn't be parsed. Please reload the customer data."

def lowercase_value(value):
    """Make dictionary lowercase"""
    if isinstance(value, dict):
        return dict((k, lowercase_value(v)) for k, v in value.items())
    elif isinstance(value, str):
        return value.lower()
    elif isinstance(value, (list, set, tuple)):
        tp = type(value)
        return tp(lowercase_value(i) for i in value)
    else:
        return value


# Callback Methods
def before_tool(
    tool: BaseTool, args: Dict[str, Any], tool_context: CallbackContext
):
    # Make sure all values that the agent is sending to tools are lowercase
    lowercase_value(args)

    # Several tools require customer_id as input. We don't want to rely
    # solely on the model picking the right customer id. We validate it.
    # Alternative: tools can fetch the customer_id from the state directly.
    if 'customer_id' in args:
        valid, err = validate_customer_id(args['customer_id'], tool_context.state)
        if not valid:
            return err

    # Check for the next tool call and then act accordingly.
    # Example logic based on the tool being called.
    if tool.name == "sync_ask_for_approval":
        amount = args.get("value", None)
        if amount and amount <= 10:  # Example business rule
            return {
                "status": "approved",
                "message": "You can approve this discount; no manager needed."
            }
        # Add more logic checks here as needed for your tools.

    if tool.name == "modify_cart":
        if (
            args.get("items_added") is True
            and args.get("items_removed") is True
        ):
            return {"result": "I have added and removed the requested items."}
    return None

def after_tool(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext, tool_response: Dict
) -> Optional[Dict]:
    # After approvals, we perform operations deterministically in the callback
    # to apply the discount in the cart.
    if tool.name == "sync_ask_for_approval":
        if tool_response and tool_response.get('status') == "approved":
            logger.debug("Applying discount to the cart")
            # Actually make changes to the cart

    if tool.name == "approve_discount":
        if tool_response and tool_response.get('status') == "ok":
            logger.debug("Applying discount to the cart")
            # Actually make changes to the cart

    return None

def before_agent(callback_context):
    inv = getattr(callback_context, "_invocation_context", None)
    if not inv:
        logger.debug("before_agent: invocation context is missing")
        return

    session_meta: Optional[Dict[str, Any]] = None

    # 1. Попробуем получить данные напрямую из inv.inputs (если поле существует в текущей версии ADK)
    raw_inputs = getattr(inv, "inputs", None)
    if isinstance(raw_inputs, dict):
        session_meta = raw_inputs.get("sessionMetadata")

    # 2. Если напрямую не получилось, пробуем извлечь из run_config
    if session_meta is None:
        run_config = getattr(inv, "run_config", None)
        possible_sources: list[Dict[str, Any]] = []

        if run_config is not None:
            for attr_name in ("inputs", "extra_kwargs"):
                attr_value = getattr(run_config, attr_name, None)
                if isinstance(attr_value, dict):
                    possible_sources.append(attr_value)

            # run_config — это pydantic-модель, поэтому можно безопасно получить dict
            try:
                rc_dump = run_config.model_dump(exclude_none=True)
                if isinstance(rc_dump, dict):
                    possible_sources.append(rc_dump)
            except Exception as exc:
                logger.debug("before_agent: failed to dump run_config: %s", exc)

        for source in possible_sources:
            if "sessionMetadata" in source:
                session_meta = source["sessionMetadata"]
                break
            inputs_candidate = source.get("inputs")
            if isinstance(inputs_candidate, dict) and "sessionMetadata" in inputs_candidate:
                session_meta = inputs_candidate["sessionMetadata"]
                break

    if session_meta:
        callback_context.state["session_metadata"] = session_meta
        logger.debug("before_agent: session metadata stored: %s", session_meta)
    else:
        try:
            dump = inv.model_dump(exclude_none=True)
            run_config_dump = dump.get("run_config") if isinstance(dump, dict) else None
        except Exception as exc:
            dump = {"error": f"failed to dump invocation context: {exc}"}
            run_config_dump = None

        if isinstance(run_config_dump, dict):
            logger.debug(
                "before_agent: run_config dump keys=%s",
                list(run_config_dump.keys()),
            )
            nested_inputs = run_config_dump.get("inputs")
            if nested_inputs:
                logger.debug("before_agent: run_config.inputs=%s", nested_inputs)
            extra_kwargs = run_config_dump.get("extra_kwargs")
            if extra_kwargs:
                logger.debug(
                    "before_agent: run_config.extra_kwargs=%s", extra_kwargs
                )

        logger.debug(
            "before_agent: session metadata not found; invocation dump keys=%s",
            list(dump.keys()) if isinstance(dump, dict) else dump,
        )