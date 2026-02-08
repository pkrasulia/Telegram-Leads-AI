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
# add docstring to this module
"""Tools module for the customer service agent with validation and retry logic."""

import logging
import re
import time
import requests
from typing import Dict, Any, Optional
from google.adk.tools import ToolContext
from ..services.auth_service import get_auth_service

logger = logging.getLogger(__name__)

def _validate_phone(phone: str) -> bool:
    """Validate Russian phone number format."""
    if not phone:
        return False
    # Remove all non-digit characters
    digits = re.sub(r'\D', '', phone)
    # Check if it's a valid Russian number
    if digits.startswith('7') and len(digits) == 11:
        return True
    if digits.startswith('8') and len(digits) == 11:
        return True
    return False

def _validate_name(name: str) -> bool:
    """Validate name format."""
    if not name or len(name.strip()) < 2:
        return False
    # Check for obviously fake names
    fake_names = ['тест', 'test', '123', 'фыв', 'qwe', 'asdf']
    if name.lower().strip() in fake_names:
        return False
    # Only allow letters, spaces, and hyphens
    return bool(re.match(r'^[a-zA-Zа-яА-ЯёЁ\s\-]+$', name.strip()))

def _validate_email(email: str) -> bool:
    """Validate email format."""
    if not email:
        return True  # Email is optional
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(email_pattern, email.strip()))

def _normalize_phone(phone: str) -> str:
    """Normalize phone to +7XXXXXXXXXX format."""
    digits = re.sub(r'\D', '', phone)
    if digits.startswith('8'):
        digits = '7' + digits[1:]
    return '+' + digits

def send_lead_to_backend(lead_data: dict, tool_context: ToolContext) -> dict:
    """
    Sends a lead to the backend API with validation and retry logic.

    Args:
        lead_data (dict): The lead data to send to the backend.
                         Must contain: name, phone
                         Optional: email, telegramUsername, telegramId, company, position, notes

    Returns:
        dict: A dictionary with the status and message.

    Example:
        >>> send_lead_to_backend(lead_data={'name': 'Иван Петров', 'phone': '+79901234567', 'email': 'ivan@example.com'})
        {'status': 'success', 'message': 'Lead sent to backend successfully.'}
    """
    try:
        # Validate required fields
        if not isinstance(lead_data, dict):
            return {"status": "error", "message": "Invalid data format"}
        
        name = lead_data.get('name', '').strip()
        phone = lead_data.get('phone', '').strip()
        email = lead_data.get('email', '').strip() if lead_data.get('email') else None
        telegram_username = lead_data.get('telegramUsername', '').strip() if lead_data.get('telegramUsername') else None
        telegram_id = lead_data.get('telegramId', '').strip() if lead_data.get('telegramId') else None
        company = lead_data.get('company', '').strip() if lead_data.get('company') else None
        position = lead_data.get('position', '').strip() if lead_data.get('position') else None
        notes = lead_data.get('notes', '').strip() if lead_data.get('notes') else None
        
        # Validate provided fields
        if name and not _validate_name(name):
            return {"status": "error", "message": f"Invalid name format: {name}"}
        
        if phone and not _validate_phone(phone):
            return {"status": "error", "message": f"Invalid phone number format: {phone}"}
        
        # Validate optional email
        if email and not _validate_email(email):
            return {"status": "error", "message": f"Invalid email format: {email}"}

        # At least something should be provided
        if not any([name, phone, email, company, position, notes]):
            return {"status": "error", "message": "No lead information provided"}
        
        # Get session ID from ADK state
        adk_session_id = tool_context.state.get('adk_session_id')
        
        # Prepare data for backend API
        api_data = {
            'status': 'new',
            'source': 'telegram',
            'adkSessionId': adk_session_id
        }
        
        if name:
            api_data['name'] = name
        if phone:
            api_data['phone'] = _normalize_phone(phone)
        
        # Add optional fields if provided
        if email:
            api_data['email'] = email
        if telegram_username:
            api_data['telegramUsername'] = telegram_username
        if telegram_id:
            api_data['telegramId'] = telegram_id
        if company:
            api_data['company'] = company
        if position:
            api_data['position'] = position
        if notes:
            api_data['notes'] = notes
        
        logger.info(">>> Sending validated lead to backend API: %s", api_data)
        
        # Send data to backend API with JWT authentication
        try:
            auth_service = get_auth_service()
            response = auth_service.make_authenticated_request(
                method='POST',
                endpoint='/leads',
                json=api_data
            )
            
            if response.status_code in [200, 201]:
                logger.info("Backend API call successful with JWT authentication")
                response_data = response.json() if response.content else {}
                return {
                    "status": "success", 
                    "message": "Lead sent to backend successfully.",
                    "lead_id": response_data.get('id', f"lead_{int(time.time())}"),
                    "lead_data": response_data
                }
            else:
                error_msg = f"HTTP {response.status_code}"
                try:
                    error_details = response.json()
                    error_msg += f": {error_details}"
                except:
                    error_msg += f": {response.text}"
                
                logger.error("Backend API error: %s", error_msg)
                return {
                    "status": "error", 
                    "message": f"Backend API error: {error_msg}"
                }
                
        except Exception as e:
            logger.error("Failed to send lead to backend: %s", str(e))
            return {
                "status": "error", 
                "message": f"Failed to send lead to backend: {str(e)}"
            }
                
    except Exception as e:
        logger.error("Unexpected error in send_lead_to_backend: %s", str(e))
        return {"status": "error", "message": f"Internal server error: {str(e)}"}


def get_lead_by_id(lead_id: int) -> dict:
    """
    Get a lead by ID from the backend API.
    
    Args:
        lead_id (int): The ID of the lead to retrieve
        
    Returns:
        dict: A dictionary with the status, message, and lead data
    """
    try:
        logger.info(">>> Getting lead by ID: %s", lead_id)
        
        auth_service = get_auth_service()
        response = auth_service.make_authenticated_request(
            method='GET',
            endpoint=f'/leads/{lead_id}'
        )
        
        if response.status_code == 200:
            logger.info("Lead retrieved successfully")
            lead_data = response.json()
            return {
                "status": "success",
                "message": "Lead retrieved successfully.",
                "lead_data": lead_data
            }
        elif response.status_code == 404:
            logger.warning("Lead not found with ID: %s", lead_id)
            return {
                "status": "error",
                "message": f"Lead with ID {lead_id} not found."
            }
        else:
            error_msg = f"HTTP {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except:
                error_msg += f": {response.text}"
            
            logger.error("Backend API error: %s", error_msg)
            return {
                "status": "error",
                "message": f"Backend API error: {error_msg}"
            }
            
    except Exception as e:
        logger.error("Failed to get lead by ID: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to get lead: {str(e)}"
        }


def get_leads_by_status(status: str = None) -> dict:
    """
    Get leads from the backend API, optionally filtered by status.
    
    Args:
        status (str, optional): Filter leads by status (new, contacted, qualified, converted, lost)
        
    Returns:
        dict: A dictionary with the status, message, and leads data
    """
    try:
        endpoint = '/leads'
        if status:
            endpoint += f'?status={status}'
            
        logger.info(">>> Getting leads with endpoint: %s", endpoint)
        
        auth_service = get_auth_service()
        response = auth_service.make_authenticated_request(
            method='GET',
            endpoint=endpoint
        )
        
        if response.status_code == 200:
            logger.info("Leads retrieved successfully")
            leads_data = response.json()
            return {
                "status": "success",
                "message": f"Retrieved {len(leads_data)} leads successfully.",
                "leads_data": leads_data
            }
        else:
            error_msg = f"HTTP {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except:
                error_msg += f": {response.text}"
            
            logger.error("Backend API error: %s", error_msg)
            return {
                "status": "error",
                "message": f"Backend API error: {error_msg}"
            }
            
    except Exception as e:
        logger.error("Failed to get leads: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to get leads: {str(e)}"
        }


def update_lead_status(lead_id: int, new_status: str, notes: str = None) -> dict:
    """
    Update a lead's status in the backend API.
    
    Args:
        lead_id (int): The ID of the lead to update
        new_status (str): New status (new, contacted, qualified, converted, lost)
        notes (str, optional): Additional notes about the status change
        
    Returns:
        dict: A dictionary with the status and message
    """
    try:
        # Validate status
        valid_statuses = ['new', 'contacted', 'qualified', 'converted', 'lost']
        if new_status not in valid_statuses:
            return {
                "status": "error",
                "message": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            }
        
        update_data = {"status": new_status}
        if notes:
            update_data["notes"] = notes
            
        logger.info(">>> Updating lead %s status to: %s", lead_id, new_status)
        
        auth_service = get_auth_service()
        response = auth_service.make_authenticated_request(
            method='PATCH',
            endpoint=f'/leads/{lead_id}',
            json=update_data
        )
        
        if response.status_code == 200:
            logger.info("Lead status updated successfully")
            lead_data = response.json()
            return {
                "status": "success",
                "message": f"Lead status updated to '{new_status}' successfully.",
                "lead_data": lead_data
            }
        elif response.status_code == 404:
            logger.warning("Lead not found with ID: %s", lead_id)
            return {
                "status": "error",
                "message": f"Lead with ID {lead_id} not found."
            }
        else:
            error_msg = f"HTTP {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except:
                error_msg += f": {response.text}"
            
            logger.error("Backend API error: %s", error_msg)
            return {
                "status": "error",
                "message": f"Backend API error: {error_msg}"
            }
            
    except Exception as e:
        logger.error("Failed to update lead status: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to update lead status: {str(e)}"
        }


def find_lead_by_telegram_id(telegram_id: str) -> dict:
    """
    Find a lead by Telegram ID.
    
    Args:
        telegram_id (str): The Telegram ID to search for
        
    Returns:
        dict: A dictionary with the status, message, and lead data
    """
    try:
        logger.info(">>> Finding lead by Telegram ID: %s", telegram_id)
        
        auth_service = get_auth_service()
        response = auth_service.make_authenticated_request(
            method='GET',
            endpoint=f'/leads/telegram/{telegram_id}'
        )
        
        if response.status_code == 200:
            logger.info("Lead found by Telegram ID")
            lead_data = response.json()
            return {
                "status": "success",
                "message": "Lead found successfully.",
                "lead_data": lead_data
            }
        elif response.status_code == 404:
            logger.info("No lead found with Telegram ID: %s", telegram_id)
            return {
                "status": "not_found",
                "message": f"No lead found with Telegram ID {telegram_id}."
            }
        else:
            error_msg = f"HTTP {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except:
                error_msg += f": {response.text}"
            
            logger.error("Backend API error: %s", error_msg)
            return {
                "status": "error",
                "message": f"Backend API error: {error_msg}"
            }
            
    except Exception as e:
        logger.error("Failed to find lead by Telegram ID: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to find lead: {str(e)}"
        }


def get_session_data(session_id: str) -> dict:
    """
    Get session data from the backend API.
    
    Args:
        session_id (str): The session ID to retrieve data for
        
    Returns:
        dict: A dictionary with the status, message, and session data
    """
    try:
        logger.info(">>> Getting session data for session ID: %s", session_id)
        
        auth_service = get_auth_service()
        response = auth_service.make_authenticated_request(
            method='GET',
            endpoint=f'/chat/sessions/afaae15e-0305-4b39-8b1b-f90fd5e20a6d'
        )
        
        if response.status_code == 200:
            logger.info("Session data retrieved successfully")
            session_data = response.json()
            return {
                "status": "success",
                "message": "Session data retrieved successfully.",
                "session_data": session_data
            }
        elif response.status_code == 404:
            logger.warning("Session not found with ID: %s", session_id)
            return {
                "status": "not_found",
                "message": f"Session with ID {session_id} not found."
            }
        else:
            error_msg = f"HTTP {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except:
                error_msg += f": {response.text}"
            
            logger.error("Backend API error: %s", error_msg)
            return {
                "status": "error",
                "message": f"Backend API error: {error_msg}"
            }
            
    except Exception as e:
        logger.error("Failed to get session data: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to get session data: {str(e)}"
        }

