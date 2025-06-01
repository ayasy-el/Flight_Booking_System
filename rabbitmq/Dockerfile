FROM rabbitmq:3.12-management

# Download and enable the delayed message exchange plugin
RUN apt-get update && apt-get install -y wget && \
    wget -O /opt/rabbitmq/plugins/rabbitmq_delayed_message_exchange-3.12.0.ez \
    https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v3.12.0/rabbitmq_delayed_message_exchange-3.12.0.ez && \
    rabbitmq-plugins enable --offline rabbitmq_delayed_message_exchange && \
    apt-get remove -y wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*