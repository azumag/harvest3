FROM node:18-bullseye

# Install basic development tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    sudo \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Ensure node user has proper permissions
RUN groupmod --gid $USER_GID $USERNAME \
    && usermod --uid $USER_UID --gid $USER_GID $USERNAME \
    && chown -R $USER_UID:$USER_GID /home/$USERNAME

# Add node user to docker group for docker socket access
RUN groupadd -f docker && usermod -aG docker $USERNAME

# Grant sudo access to node user
RUN echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Set working directory
WORKDIR /workspace

# Switch to node user
USER $USERNAME

# Set npm global directory for node user
ENV NPM_CONFIG_PREFIX=/home/$USERNAME/.npm-global
ENV PATH=$NPM_CONFIG_PREFIX/bin:$PATH
RUN mkdir -p $NPM_CONFIG_PREFIX

# Install global npm packages
RUN npm install -g nodemon pm2

# Keep container running
CMD ["sleep", "infinity"]