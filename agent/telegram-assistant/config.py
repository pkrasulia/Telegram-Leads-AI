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
"""Configuration module for the customer service agent."""

import os
import logging
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import BaseModel, Field


logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class AgentModel(BaseModel):
    """Agent model settings."""

    name: str = Field(default="telegram_customer_service_agent")
    model: str = Field(default="gemini-flash-latest")


class Config(BaseSettings):
    """Configuration settings for the customer service agent."""

    model_config = SettingsConfigDict(
        env_file=os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "../../.env.agent"
        ),
        env_prefix="",
        case_sensitive=True,
        extra="ignore",
    )

    agent_settings: AgentModel = Field(default=AgentModel())
    app_name: str = "telegram_customer_service_app"
    
    # Google Cloud и AI настройки
    GOOGLE_CLOUD_PROJECT: str = Field(default="my_project")
    GOOGLE_CLOUD_LOCATION: str = Field(default="us-central1")
    GOOGLE_GENAI_USE_VERTEXAI: str = Field(default="0")
    GOOGLE_API_KEY: str | None = Field(default="")

    # Environment
    NODE_ENV: str = Field(default="development")
    
    # Настройки для истории сообщений
    MESSAGE_HISTORY_LIMIT: int = Field(default=20)
    BACKEND_URL: str = Field(default="http://backend:4343")
    
    # Service Account для аутентификации с backend
    SERVICE_ACCOUNT_LOGIN: str = Field(default="service@example.com")
    SERVICE_ACCOUNT_PASSWORD: str = Field(default="secret")
